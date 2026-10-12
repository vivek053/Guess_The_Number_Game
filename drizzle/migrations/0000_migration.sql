CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'lobby',
  round int NOT NULL DEFAULT 1,
  current_turn uuid,
  winner uuid,
  round_started_at timestamptz,
  round_ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '2 hours'
);
GRANT SELECT ON public.rooms TO authenticated;
GRANT ALL ON public.rooms TO service_role;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.room_players (
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  name text NOT NULL,
  seat int NOT NULL,
  wins int NOT NULL DEFAULT 0,
  losses int NOT NULL DEFAULT 0,
  guesses_total int NOT NULL DEFAULT 0,
  ready boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id),
  UNIQUE (room_id, seat)
);
GRANT SELECT ON public.room_players TO authenticated;
GRANT ALL ON public.room_players TO service_role;
ALTER TABLE public.room_players ENABLE ROW LEVEL SECURITY;

-- Secrets: no grants to authenticated/anon at all. Only security definer functions touch it.
CREATE TABLE public.room_secrets (
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  secret int NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
REVOKE ALL ON public.room_secrets FROM anon, authenticated;
GRANT ALL ON public.room_secrets TO service_role;
ALTER TABLE public.room_secrets ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.guesses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  round int NOT NULL,
  user_id uuid NOT NULL,
  value int NOT NULL,
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guesses_room_round_idx ON public.guesses(room_id, round);
GRANT SELECT ON public.guesses TO authenticated;
GRANT ALL ON public.guesses TO service_role;
ALTER TABLE public.guesses ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_room_member(_room uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.room_players WHERE room_id = _room AND user_id = auth.uid());
$$;

CREATE POLICY "members read rooms" ON public.rooms FOR SELECT TO authenticated USING (public.is_room_member(id));
CREATE POLICY "members read players" ON public.room_players FOR SELECT TO authenticated USING (public.is_room_member(room_id));
CREATE POLICY "members read guesses" ON public.guesses FOR SELECT TO authenticated USING (public.is_room_member(room_id));

CREATE OR REPLACE FUNCTION public.clean_name(_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(NULLIF(left(btrim(regexp_replace(COALESCE(_name,''), '[[:cntrl:]]', '', 'g')), 20), ''), 'Player');
$$;

CREATE OR REPLACE FUNCTION public.create_room(p_name text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text; v_room uuid; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  DELETE FROM public.rooms WHERE expires_at < now();
  LOOP
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.rooms WHERE code = v_code);
  END LOOP;
  INSERT INTO public.rooms(code) VALUES (v_code) RETURNING id INTO v_room;
  INSERT INTO public.room_players(room_id, user_id, name, seat) VALUES (v_room, v_uid, public.clean_name(p_name), 1);
  RETURN v_code;
END $$;

CREATE OR REPLACE FUNCTION public.join_room(p_code text, p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.rooms%ROWTYPE; v_uid uuid := auth.uid(); v_count int; v_seat int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_code !~ '^[0-9]{6}$' THEN RAISE EXCEPTION 'Room code must be 6 digits'; END IF;
  SELECT * INTO r FROM public.rooms WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.room_players WHERE room_id = r.id AND user_id = v_uid) THEN
    UPDATE public.rooms SET expires_at = now() + interval '2 hours' WHERE id = r.id;
    RETURN r.id;
  END IF;
  IF r.expires_at < now() THEN RAISE EXCEPTION 'This room has expired'; END IF;
  SELECT count(*) INTO v_count FROM public.room_players WHERE room_id = r.id;
  IF v_count >= 2 THEN RAISE EXCEPTION 'Room is full'; END IF;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.room_players WHERE room_id = r.id AND seat = 1) THEN 2 ELSE 1 END INTO v_seat;
  INSERT INTO public.room_players(room_id, user_id, name, seat) VALUES (r.id, v_uid, public.clean_name(p_name), v_seat);
  UPDATE public.rooms SET status = 'picking', current_turn = NULL, winner = NULL, updated_at = now(),
    expires_at = now() + interval '2 hours' WHERE id = r.id;
  RETURN r.id;
END $$;

CREATE OR REPLACE FUNCTION public.set_secret(p_room uuid, p_secret int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.rooms%ROWTYPE; v_uid uuid := auth.uid(); v_ready int; v_first uuid;
BEGIN
  SELECT * INTO r FROM public.rooms WHERE id = p_room FOR UPDATE;
  IF NOT FOUND OR NOT public.is_room_member(p_room) THEN RAISE EXCEPTION 'Not in this room'; END IF;
  IF r.status <> 'picking' THEN RAISE EXCEPTION 'You cannot pick a number right now'; END IF;
  IF p_secret IS NULL OR p_secret < 1 OR p_secret > 100 THEN RAISE EXCEPTION 'Pick a whole number from 1 to 100'; END IF;
  INSERT INTO public.room_secrets(room_id, user_id, secret) VALUES (p_room, v_uid, p_secret)
    ON CONFLICT (room_id, user_id) DO UPDATE SET secret = EXCLUDED.secret;
  UPDATE public.room_players SET ready = true WHERE room_id = p_room AND user_id = v_uid;
  SELECT count(*) INTO v_ready FROM public.room_players WHERE room_id = p_room AND ready;
  IF v_ready = 2 THEN
    SELECT user_id INTO v_first FROM public.room_players WHERE room_id = p_room ORDER BY random() LIMIT 1;
    UPDATE public.rooms SET status = 'playing', current_turn = v_first, round_started_at = now(),
      round_ended_at = NULL, updated_at = now(), expires_at = now() + interval '2 hours' WHERE id = p_room;
  ELSE
    UPDATE public.rooms SET updated_at = now() WHERE id = p_room;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.submit_guess(p_room uuid, p_value int)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.rooms%ROWTYPE; v_uid uuid := auth.uid(); v_opp uuid; v_secret int; v_result text;
BEGIN
  SELECT * INTO r FROM public.rooms WHERE id = p_room FOR UPDATE;
  IF NOT FOUND OR NOT public.is_room_member(p_room) THEN RAISE EXCEPTION 'Not in this room'; END IF;
  IF r.status <> 'playing' THEN RAISE EXCEPTION 'The game is not running'; END IF;
  IF r.current_turn IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'It is not your turn'; END IF;
  IF p_value IS NULL OR p_value < 1 OR p_value > 100 THEN RAISE EXCEPTION 'Guess a whole number from 1 to 100'; END IF;
  SELECT user_id INTO v_opp FROM public.room_players WHERE room_id = p_room AND user_id <> v_uid;
  SELECT secret INTO v_secret FROM public.room_secrets WHERE room_id = p_room AND user_id = v_opp;
  IF v_secret IS NULL THEN RAISE EXCEPTION 'Opponent has no number'; END IF;
  v_result := CASE WHEN p_value < v_secret THEN 'higher' WHEN p_value > v_secret THEN 'lower' ELSE 'correct' END;
  INSERT INTO public.guesses(room_id, round, user_id, value, result) VALUES (p_room, r.round, v_uid, p_value, v_result);
  UPDATE public.room_players SET guesses_total = guesses_total + 1 WHERE room_id = p_room AND user_id = v_uid;
  IF v_result = 'correct' THEN
    UPDATE public.room_players SET wins = wins + 1 WHERE room_id = p_room AND user_id = v_uid;
    UPDATE public.room_players SET losses = losses + 1 WHERE room_id = p_room AND user_id = v_opp;
    UPDATE public.rooms SET status = 'finished', winner = v_uid, current_turn = NULL, round_ended_at = now(),
      updated_at = now(), expires_at = now() + interval '2 hours' WHERE id = p_room;
  ELSE
    UPDATE public.rooms SET current_turn = v_opp, updated_at = now(), expires_at = now() + interval '2 hours' WHERE id = p_room;
  END IF;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.new_round(p_room uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.rooms%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.rooms WHERE id = p_room FOR UPDATE;
  IF NOT FOUND OR NOT public.is_room_member(p_room) THEN RAISE EXCEPTION 'Not in this room'; END IF;
  IF r.status <> 'finished' THEN RETURN; END IF;
  DELETE FROM public.room_secrets WHERE room_id = p_room;
  UPDATE public.room_players SET ready = false WHERE room_id = p_room;
  UPDATE public.rooms SET status = 'picking', round = round + 1, winner = NULL, current_turn = NULL,
    round_started_at = NULL, round_ended_at = NULL, updated_at = now(), expires_at = now() + interval '2 hours'
    WHERE id = p_room;
END $$;

CREATE OR REPLACE FUNCTION public.leave_room(p_room uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_left int;
BEGIN
  PERFORM 1 FROM public.rooms WHERE id = p_room FOR UPDATE;
  IF NOT public.is_room_member(p_room) THEN RETURN; END IF;
  DELETE FROM public.room_players WHERE room_id = p_room AND user_id = v_uid;
  SELECT count(*) INTO v_left FROM public.room_players WHERE room_id = p_room;
  IF v_left = 0 THEN
    DELETE FROM public.rooms WHERE id = p_room;
  ELSE
    DELETE FROM public.room_secrets WHERE room_id = p_room;
    UPDATE public.room_players SET ready = false WHERE room_id = p_room;
    UPDATE public.rooms SET status = 'lobby', winner = NULL, current_turn = NULL, round_started_at = NULL,
      round_ended_at = NULL, updated_at = now() WHERE id = p_room;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reveal_secrets(p_room uuid)
RETURNS TABLE(user_id uuid, secret int) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_room_member(p_room) THEN RAISE EXCEPTION 'Not in this room'; END IF;
  IF (SELECT status FROM public.rooms WHERE id = p_room) <> 'finished' THEN RAISE EXCEPTION 'Round still in progress'; END IF;
  RETURN QUERY SELECT s.user_id, s.secret FROM public.room_secrets s WHERE s.room_id = p_room;
END $$;

CREATE OR REPLACE FUNCTION public.my_secret(p_room uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT secret FROM public.room_secrets WHERE room_id = p_room AND user_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.create_room(text), public.join_room(text, text), public.set_secret(uuid, int),
  public.submit_guess(uuid, int), public.new_round(uuid), public.leave_room(uuid), public.reveal_secrets(uuid),
  public.my_secret(uuid), public.is_room_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_room(text), public.join_room(text, text), public.set_secret(uuid, int),
  public.submit_guess(uuid, int), public.new_round(uuid), public.leave_room(uuid), public.reveal_secrets(uuid),
  public.my_secret(uuid), public.is_room_member(uuid) TO authenticated;

ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.room_players REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms, public.room_players, public.guesses;