\restrict ZzZ999otherToken

SET statement_timeout = 5;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE TABLE public.accounts (
    id uuid NOT NULL,
    user_id uuid NOT NULL
);

CREATE FUNCTION public.touch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text NOT NULL
);

\unrestrict ZzZ999otherToken
