-- Run this in Supabase SQL Editor (supabase.com → your project → SQL Editor)
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  wants_emails boolean default false,
  created_at timestamptz default now()
);

-- Allow users to read/update only their own row
alter table profiles enable row level security;
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

-- Allow insert on sign-up (via service role or trigger)
create policy "Users can insert own profile" on profiles for insert with check (auth.uid() = id);
