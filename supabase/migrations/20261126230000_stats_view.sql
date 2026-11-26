-- 6차시: 우리 반 질문 보드 통계 뷰 및 정답 기준 표
-- 설계: TRD.md 4절 · 보호 원칙: 설계명세서.md 5절
--
-- 개인정보·보호 원칙
--  * 기존 answers·questions 표의 열·제약·RLS는 변경하지 않는다.
--  * 학생 순위·합계 점수를 만드는 뷰는 두지 않는다.
--  * 다문화 학생 전용 뷰는 따로 만들지 않는다.
--  * 새 표·뷰·함수 모두 브라우저 키(anon·authenticated)에서 권한을 회수한다.
--  * 뷰 4개 모두 security_invoker = true로 생성해 호출자 권한·RLS를 따른다.
--  * 서버 함수(api/stats.js)가 secret key(service_role)로만 조회한다.
--
-- 사용 방법: Supabase 대시보드 → SQL Editor에 붙여넣고 Run (여러 번 실행해도 안전하다).

-- ============================================================================
-- 1. answer_keys — 확인 질문 1~4번 정답 기준 (materials/activities.json 기준)
-- ============================================================================
create table if not exists public.answer_keys (
  level       text      not null check (level in ('basic', 'normal', 'advanced', 'multicultural')),
  question_no smallint  not null check (question_no between 1 and 4),
  slot_no     smallint  not null check (slot_no >= 1),
  match       text      not null check (match in ('exact', 'blank')),
  accepted    text      not null check (char_length(accepted) between 1 and 500),
  primary key (level, question_no, slot_no, accepted)
);

comment on table public.answer_keys is '확인 질문 1~4번 정답 기준(5번 서술형 제외). materials/activities.json과 동기화.';

insert into public.answer_keys (level, question_no, slot_no, match, accepted) values
  -- 기초 (basic)
  ('basic', 1, 1, 'exact', '문장 앞부분을 보고 다음 단어 맞히기'),
  ('basic', 2, 1, 'exact', '2017년'),
  ('basic', 3, 1, 'exact', '비슷하다'),
  ('basic', 4, 1, 'blank', 'Queen'),
  ('basic', 4, 1, 'blank', '퀸'),
  ('basic', 4, 1, 'blank', '여왕'),

  -- 보통 (normal)
  ('normal', 1, 1, 'exact', '단어 사이의 뜻의 관계를 숫자에 담으려고'),
  ('normal', 2, 1, 'exact', '처음에는 무작위로 시작하지만 학습하며 서로 다른 언어 특징을 맡게 된다'),
  ('normal', 3, 1, 'exact', '12'),
  ('normal', 3, 2, 'exact', '1억 2,400만'),
  ('normal', 4, 1, 'blank', '순서'),

  -- 심화 (advanced)
  ('advanced', 1, 1, 'exact', '가장 높은 후보의 확률이 더 커지고 분포가 뾰족해진다'),
  ('advanced', 2, 1, 'exact', '다음 토큰을 예측하는 모델이라 각 토큰이 앞의 토큰만 보게 하려고'),
  ('advanced', 3, 1, 'exact', '교차 엔트로피'),
  ('advanced', 3, 2, 'exact', '경사 하강법'),
  ('advanced', 4, 1, 'blank', '768'),
  ('advanced', 4, 2, 'blank', '12'),

  -- 다문화 (기존 저장 행 호환용 정답 기준, 별도 다문화 뷰는 만들지 않음)
  ('multicultural', 1, 1, 'exact', '다음 단어 맞히기'),
  ('multicultural', 2, 1, 'exact', '2017년'),
  ('multicultural', 3, 1, 'exact', '비슷합니다'),
  ('multicultural', 4, 1, 'blank', '예측')
on conflict do nothing;

alter table public.answer_keys enable row level security;

-- ============================================================================
-- 2. 보조 함수 stats_norm(text) — 학생 화면 js/activities.js의 normalize()와 동일
-- ============================================================================
create or replace function public.stats_norm(src text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(normalize(coalesce(src, ''), NFC), '\s+', '', 'g'));
$$;

-- ============================================================================
-- 3. 뷰 answers_latest — 학생·문항별 가장 최근 답 1건 + 자동 채점(is_correct)
-- ============================================================================
create or replace view public.answers_latest
with (security_invoker = true)
as
with latest as (
  select distinct on (class_code, student_no, level, question_no)
    class_code,
    student_no,
    level,
    question_no,
    answer,
    created_at
  from public.answers
  order by class_code, student_no, level, question_no, created_at desc, id desc
),
slot_counts as (
  select level, question_no, count(distinct slot_no)::int as expected_slots
  from public.answer_keys
  group by level, question_no
)
select
  l.class_code,
  l.student_no,
  l.level,
  l.question_no,
  l.answer,
  l.created_at,
  case
    when sc.expected_slots is null then null
    when coalesce(array_length(string_to_array(l.answer, ' / '), 1), 0) <> sc.expected_slots then false
    else (
      select bool_and(
        exists (
          select 1
          from public.answer_keys ak
          where ak.level = l.level
            and ak.question_no = l.question_no
            and ak.slot_no = p.slot_no
            and (
              public.stats_norm(p.part) = public.stats_norm(ak.accepted)
              or (
                ak.match = 'blank'
                and starts_with(public.stats_norm(p.part), public.stats_norm(ak.accepted))
                and substring(
                  public.stats_norm(p.part)
                  from char_length(public.stats_norm(ak.accepted)) + 1
                ) ~ '^(을|를|이|가|은|는|의|로|으로|도)$'
              )
            )
        )
      )
      from unnest(string_to_array(l.answer, ' / ')) with ordinality as p(part, slot_no)
    )
  end as is_correct
from latest l
left join slot_counts sc
  on sc.level = l.level
 and sc.question_no = l.question_no;

-- ============================================================================
-- 4. 통계 뷰 3종 (반별 수준 질문 수 · 확인 질문 정답률 · 힌트 단계 분포)
-- ============================================================================
create or replace view public.stats_level_questions
with (security_invoker = true)
as
select
  class_code,
  level,
  count(*)::int as question_count,
  count(distinct student_no)::int as student_count
from public.questions
group by class_code, level;

create or replace view public.stats_quiz
with (security_invoker = true)
as
select
  class_code,
  level,
  question_no,
  count(*)::int as submitted,
  case
    when question_no between 1 and 4 then count(*) filter (where is_correct is true)::int
    else null
  end as correct,
  case
    when question_no between 1 and 4 and count(*) > 0
      then round((count(*) filter (where is_correct is true))::numeric * 100.0 / count(*), 1)
    else null
  end as correct_rate
from public.answers_latest
group by class_code, level, question_no;

create or replace view public.stats_hint_steps
with (security_invoker = true)
as
select
  class_code,
  hint_step,
  count(*)::int as question_count
from public.questions
group by class_code, hint_step;

-- ============================================================================
-- 5. 접근 권한: 브라우저(anon·authenticated) 차단, 서버 함수(service_role)만 허용
-- ============================================================================
revoke all on table public.answer_keys from anon, authenticated;
revoke all on table public.answers_latest from anon, authenticated;
revoke all on table public.stats_level_questions from anon, authenticated;
revoke all on table public.stats_quiz from anon, authenticated;
revoke all on table public.stats_hint_steps from anon, authenticated;
revoke all on function public.stats_norm(text) from anon, authenticated;

grant select on table public.answer_keys to service_role;
grant select on table public.answers_latest to service_role;
grant select on table public.stats_level_questions to service_role;
grant select on table public.stats_quiz to service_role;
grant select on table public.stats_hint_steps to service_role;
grant execute on function public.stats_norm(text) to service_role;
