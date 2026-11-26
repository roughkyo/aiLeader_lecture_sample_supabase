




-- 5차시: 학생 제출 저장용 테이블 2개 (answers, questions)
-- 설계: TRD.md 14절 · 개인정보 원칙: 설계명세서.md 10절
--
-- 개인정보 원칙
--   * 실명·연락처·이메일·학교명 열을 만들지 않는다.
--   * 학생 구분은 반 코드(class_code)와 학번(student_no)만 쓴다. 연수 실습은 가상 값(예: 1-3, 7)을 쓴다.
--
-- 접근 권한 원칙
--   * 두 테이블 모두 RLS를 켠다.
--   * 브라우저(anon, authenticated)가 직접 읽고 쓰는 정책(create policy)은 만들지 않는다.
--   * 저장·조회는 서버 함수가 secret key(service_role)로만 한다. service_role은 RLS를 우회한다.
--
-- 사용 방법: Supabase 대시보드 → SQL Editor에 붙여넣고 Run (여러 번 실행해도 오류가 나지 않는다).

-- ============================================================
-- 1. answers — 확인 질문(형성평가) 답
-- ============================================================
create table if not exists public.answers (
  id          bigint generated always as identity primary key,
  class_code  text        not null check (class_code ~ '^[0-9A-Za-z-]{1,20}$'),
  student_no  text        not null check (student_no ~ '^([1-9][0-9]?|[1-6][1-9](0[1-9]|[1-5][0-9])|[1-6](0[1-9]|[12][0-9])(0[1-9]|[1-5][0-9]))$'),
  level       text        not null check (level in ('basic', 'normal', 'advanced', 'multicultural')),
  question_no smallint    not null check (question_no between 1 and 5),
  answer      text        not null check (char_length(answer) between 1 and 1000),
  created_at  timestamptz not null default now()
);

comment on table  public.answers             is '형성평가 확인 질문 답. 문항별 1줄. 실명 열 없음';
comment on column public.answers.class_code  is '반 코드(예: 1-3)';
comment on column public.answers.student_no  is '학번(숫자만). 실명 대신 사용';
comment on column public.answers.level       is '고른 수준: basic, normal, advanced, multicultural';
comment on column public.answers.question_no is '형성평가 문항 번호(1~5)';
comment on column public.answers.answer      is '학생 답(최대 1,000자)';
comment on column public.answers.created_at  is '제출 시각(자동)';

create index if not exists answers_class_student_created_idx
  on public.answers (class_code, student_no, created_at);

-- ============================================================
-- 2. questions — 학생이 AI에게 한 질문
-- ============================================================
create table if not exists public.questions (
  id            bigint generated always as identity primary key,
  class_code    text        not null check (class_code ~ '^[0-9A-Za-z-]{1,20}$'),
  student_no    text        not null check (student_no ~ '^([1-9][0-9]?|[1-6][1-9](0[1-9]|[1-5][0-9])|[1-6](0[1-9]|[12][0-9])(0[1-9]|[1-5][0-9]))$'),
  level         text        not null check (level in ('basic', 'normal', 'advanced', 'multicultural')),
  question_text text        not null check (char_length(question_text) between 1 and 300),
  hint_step     smallint    not null check (hint_step between 1 and 3),
  created_at    timestamptz not null default now()
);

comment on table  public.questions               is '학생이 AI에게 한 질문과 받은 힌트 단계. 실명 열 없음';
comment on column public.questions.class_code    is '반 코드(예: 1-3)';
comment on column public.questions.student_no    is '학번(숫자만). 실명 대신 사용';
comment on column public.questions.level         is '읽던 수준: basic, normal, advanced, multicultural';
comment on column public.questions.question_text is '학생 질문(최대 300자)';
comment on column public.questions.hint_step     is '그 질문으로 받은 힌트 단계(1~3)';
comment on column public.questions.created_at    is '질문 시각(자동)';

create index if not exists questions_class_student_created_idx
  on public.questions (class_code, student_no, created_at);

-- ============================================================
-- 3. 접근 권한: RLS 켜기 (정책은 만들지 않음)
-- ============================================================
alter table public.answers   enable row level security;
alter table public.questions enable row level security;

-- 정책이 없으면 anon·authenticated 역할은 읽기·쓰기가 모두 거부된다.
-- 테이블 권한도 회수해 한 번 더 막는다. (서버 함수의 service_role에는 영향 없음)
revoke all on table public.answers   from anon, authenticated;
revoke all on table public.questions from anon, authenticated;
