-- 비정상 학번(0, 00000, 99999, 6자리 이상) 저장 차단을 위한 student_no CHECK 제약 강화
-- 출석번호(1~99) 또는 4~5자리 학번(학년 1~6 + 반 1~29 + 번호 01~59)만 허용
-- 기존 테스트 데이터와의 충돌을 피하기 위해 NOT VALID로 적용하여 이후 모든 INSERT/UPDATE에 즉시 반영한다.

alter table public.answers
  drop constraint if exists answers_student_no_check;

alter table public.answers
  add constraint answers_student_no_check
  check (student_no ~ '^([1-9][0-9]?|[1-6][1-9](0[1-9]|[1-5][0-9])|[1-6](0[1-9]|[12][0-9])(0[1-9]|[1-5][0-9]))$')
  not valid;

alter table public.questions
  drop constraint if exists questions_student_no_check;

alter table public.questions
  add constraint questions_student_no_check
  check (student_no ~ '^([1-9][0-9]?|[1-6][1-9](0[1-9]|[1-5][0-9])|[1-6](0[1-9]|[12][0-9])(0[1-9]|[1-5][0-9]))$')
  not valid;
