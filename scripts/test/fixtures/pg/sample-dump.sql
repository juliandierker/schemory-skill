--
-- PostgreSQL database dump
--

\restrict AbC123randomToken

-- Dumped from database version 16.4
-- Dumped by pg_dump version 16.4

SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SELECT pg_catalog.set_config('search_path', '', false);

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text NOT NULL
);

ALTER TABLE public.users OWNER TO app_owner;

CREATE TABLE public.accounts (
    id uuid NOT NULL,
    user_id uuid NOT NULL
);

ALTER TABLE public.accounts OWNER TO app_owner;

CREATE FUNCTION public.touch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.touch() OWNER TO app_owner;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

\unrestrict AbC123randomToken
