# Онлайн-уровни: подключение сервера (бесплатно, ~10 минут)

Игроки смогут выкладывать свои уровни и видеть чужие в разделе **ОНЛАЙН**. Сервер: бесплатный проект Supabase, программировать ничего не нужно. Пока адрес сервера не вписан, раздел показывает только подсказку.

## 1. Создай проект
1. Зайди на https://supabase.com и войди через GitHub.
2. **New project** → любое имя, пароль базы (запиши), регион ближе к игрокам → Create. Подожди пару минут.

## 2. Создай таблицу
Открой **SQL Editor** → New query → вставь весь код ниже → **Run**:

```sql
create table public.levels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  author text not null check (char_length(author) between 1 and 24),
  data jsonb not null check (pg_column_size(data) < 1000000),
  likes integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.levels enable row level security;

create policy "anyone can read visible levels" on public.levels
  for select using (hidden = false);

create policy "anyone can add a level" on public.levels
  for insert with check (hidden = false and likes = 0);

create or replace function public.like_level(lid uuid)
returns void language sql security definer set search_path = public as $$
  update public.levels set likes = likes + 1 where id = lid and hidden = false;
$$;
grant execute on function public.like_level(uuid) to anon;
```

## 3. Впиши адрес и ключ в игру
1. В Supabase: **Project Settings → API**. Скопируй **Project URL** и ключ **anon public**.
2. В репозитории открой файл `artifacts/velocity-platformer/src/game/onlineConfig.ts` и впиши значения между кавычками:
```ts
export const ONLINE = {
  url: "https://ТВОЙ-ПРОЕКТ.supabase.co",
  anonKey: "длинный-ключ-anon-public",
};
```
3. Залей в репозиторий, как обычно. Дождись сборки.

Ключ **anon** публичный по замыслу Supabase: он безопасен, потому что права ограничены правилами из шага 2 (читать можно только открытые уровни, добавлять можно, удалять и править нельзя).

## Как это работает для игроков
- Игрок делает уровень в редакторе, **проходит его сам в режиме «▶ Тест»**, затем в меню ☰ жмёт **«☁ Выложить в сеть»**. Пока уровень не пройден, а после прохождения менялся, выложить нельзя.
- В разделе **ОНЛАЙН** все видят новые и лучшие уровни, играют и ставят 👍 (один раз с устройства).

## Модерация
Если кто-то выложил плохой уровень: в Supabase **Table Editor → levels**, найди строку и поставь `hidden = true`. Уровень сразу пропадёт из списка. Строку можно и удалить.

## Важно знать
- Любой игрок может выкладывать уровни без регистрации, поэтому изредка заглядывай в таблицу и скрывай лишнее.
- Бесплатные проекты Supabase «засыпают» после недели без запросов. Если раздел перестал грузиться, зайди в проект и нажми Restore.
- Уровни с большими картинками весят больше. Предел загрузки около 900 КБ.
