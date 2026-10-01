import { supabase } from '../supabase.js';
import { isAdmin } from '../auth.js';
import { forgetRealNames } from '../realnames.js';
import { el, errorBox, loading, message, withBusy } from '../ui.js';

export const title = '학생 관리';

// #/admin : 관리자만. 학생별 실명 입력 (학생에게는 보이지 않음)
export async function render(view, ctx) {
  if (!isAdmin(ctx.user)) {
    view.append(message('선생님만 볼 수 있는 화면이에요.', 'error'));
    return;
  }

  view.append(
    el('h1', {}, '학생 관리'),
    message('🔒 실명은 선생님(관리자)에게만 보여요. 학생들은 친구 실명을 볼 수 없어요.', 'ok'),
  );
  const box = el('div', {}, loading());
  view.append(box);

  const [{ data: profiles, error }, { data: names, error: namesError }] = await Promise.all([
    supabase.from('profiles').select('id, username, nickname, role').order('username'),
    supabase.from('student_names').select('user_id, real_name'),
  ]);
  if (error || namesError) {
    box.replaceChildren(errorBox(error ?? namesError));
    return;
  }

  const saved = new Map(names.map((row) => [row.user_id, row.real_name]));
  const students = profiles.filter((p) => p.role === 'student');
  const inputs = new Map();

  const list = el(
    'ul',
    { class: 'list' },
    students.map((p) => {
      const input = el('input', {
        id: `name-${p.username}`,
        maxlength: '20',
        value: saved.get(p.id) ?? '',
        placeholder: '실명',
        autocomplete: 'off',
      });
      inputs.set(p.id, input);
      return el(
        'li',
        { class: 'name-row' },
        el('label', { for: `name-${p.username}` }, el('strong', {}, p.username), p.nickname ? el('span', { class: 'row-meta' }, ` (${p.nickname})`) : null),
        input,
      );
    }),
  );

  const status = el('div');
  const saveButton = el('button', { type: 'button' }, '모두 저장');
  saveButton.addEventListener('click', () =>
    withBusy(saveButton, async () => {
      const upserts = [];
      const deletes = [];
      for (const [id, input] of inputs) {
        const value = input.value.trim();
        if (value && value !== saved.get(id)) upserts.push({ user_id: id, real_name: value, updated_at: new Date().toISOString() });
        if (!value && saved.has(id)) deletes.push(id);
      }
      if (upserts.length === 0 && deletes.length === 0) {
        status.replaceChildren(message('바뀐 내용이 없어요.'));
        return;
      }
      if (upserts.length) {
        const { error: upsertError } = await supabase.from('student_names').upsert(upserts, { onConflict: 'user_id' });
        if (upsertError) return status.replaceChildren(errorBox(upsertError));
      }
      if (deletes.length) {
        const { error: deleteError } = await supabase.from('student_names').delete().in('user_id', deletes);
        if (deleteError) return status.replaceChildren(errorBox(deleteError));
      }
      upserts.forEach((row) => saved.set(row.user_id, row.real_name));
      deletes.forEach((id) => saved.delete(id));
      forgetRealNames();
      status.replaceChildren(message(`저장했어요. (${upserts.length}명 저장, ${deletes.length}명 지움)`, 'ok'));
    }),
  );

  box.replaceChildren(
    students.length === 0 ? message('학생 계정이 없어요.') : list,
    status,
    el('div', { class: 'actions' }, saveButton),
  );
}
