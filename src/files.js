import { supabase } from './supabase.js';

// 게시글 첨부 파일 (Supabase Storage 비공개 보관함 "attachments")
export const BUCKET = 'attachments';
export const MAX_FILES = 5;
export const MAX_BYTES = 50 * 1024 * 1024; // 50MB (보관함 설정과 같게, Supabase 무료 플랜 최대치)
const MAX_IMAGE_SIDE = 1600; // 사진은 긴 쪽을 1600px로 줄임

// 올릴 수 있는 파일 종류: 확장자 → 파일 종류(MIME). 보관함 allowed_mime_types와 같아야 함
const TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  hwp: 'application/x-hwp',
  hwpx: 'application/vnd.hancom.hwpx',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export const ACCEPT = Object.keys(TYPES)
  .map((ext) => `.${ext}`)
  .join(',');

export const ALLOWED_TEXT = '사진(jpg, png, gif, webp), pdf, 한글(hwp, hwpx), 워드·엑셀·파워포인트, txt';

function extensionOf(name) {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : '';
}

export function isImage(mime) {
  return mime.startsWith('image/');
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// 올리기 전 검사: 문제가 있으면 이유(문장), 없으면 null
export function checkFile(file) {
  const mime = TYPES[extensionOf(file.name)];
  if (!mime) return `${file.name}: 올릴 수 없는 파일 종류예요.`;
  if (file.size === 0) return `${file.name}: 빈 파일이에요.`;
  // 사진(gif 제외)은 줄여서 올리니 나중에 검사, 나머지는 바로 검사
  if ((!isImage(mime) || mime === 'image/gif') && file.size > MAX_BYTES) return `${file.name}: 50MB보다 커서 올릴 수 없어요.`;
  return null;
}

// 사진은 다시 그려서 저장 → 촬영 위치(GPS)·기기 정보가 지워지고 크기도 작아짐
async function prepareImage(file, mime) {
  if (mime === 'image/gif') return { blob: file, mime, name: file.name }; // 움직이는 그림은 그대로
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const outMime = mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, outMime, 0.85));
  if (!blob) throw new Error('사진을 처리하지 못했어요.');
  const baseName = file.name.replace(/\.[^.]+$/, '');
  return { blob, mime: outMime, name: `${baseName}.${outMime === 'image/png' ? 'png' : 'jpg'}` };
}

// 파일 하나 올리기: 보관함에 저장 → post_files 에 기록
export async function uploadFile(userId, postId, file) {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);

  let mime = TYPES[extensionOf(file.name)];
  let blob = file;
  let name = file.name;
  if (isImage(mime)) ({ blob, mime, name } = await prepareImage(file, mime));
  if (blob.size > MAX_BYTES) throw new Error(`${file.name}: 50MB보다 커서 올릴 수 없어요.`);

  const ext = extensionOf(name);
  const path = `${userId}/${postId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  if (uploadError) throw new Error(`${file.name}: 올리지 못했어요. (${uploadError.message})`);

  const { error } = await supabase.from('post_files').insert({ post_id: postId, path, name: name.slice(0, 200), size: blob.size, mime });
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]); // 기록 실패하면 올린 파일도 지움
    throw new Error(`${file.name}: ${error.message.includes('5개') ? '글 하나에 파일은 5개까지예요.' : '기록하지 못했어요.'}`);
  }
}

// 여러 파일 올리기 → 실패한 파일의 이유 목록
export async function uploadFiles(userId, postId, files, onProgress) {
  const failures = [];
  for (const [index, file] of files.entries()) {
    onProgress?.(`파일 올리는 중… (${index + 1}/${files.length})`);
    try {
      await uploadFile(userId, postId, file);
    } catch (error) {
      failures.push(error.message);
    }
  }
  return failures;
}

export async function listFiles(postId) {
  const result = await supabase.from('post_files').select('id, path, name, size, mime, uploader_id').eq('post_id', postId).order('id');
  // 첨부 파일 표가 아직 없으면(SQL 실행 전) 첨부 없음으로 취급
  if (result.error?.code === 'PGRST205') return { data: [], error: null };
  return result;
}

// 잠깐(기본 1시간) 쓸 수 있는 내려받기 주소
export async function signedUrls(paths, seconds = 3600) {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, seconds);
  if (error) throw error;
  return Object.fromEntries(data.filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]));
}

// 원래 이름(한글 포함)으로 내려받기: 파일을 받아 와서 브라우저에서 이름을 붙여 저장
export async function download(file) {
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(file.path);
  if (error) throw error;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// 파일 하나 지우기: 보관함 → 기록 순서
export async function removeFile(file) {
  const { data, error } = await supabase.storage.from(BUCKET).remove([file.path]);
  if (error) throw error;
  if (data.length === 0) throw new Error('지울 권한이 없어요.');
  const { error: rowError } = await supabase.from('post_files').delete().eq('id', file.id);
  if (rowError) throw rowError;
}

// 글을 지우기 전에 그 글의 파일을 보관함에서 모두 지움 (기록은 글과 함께 자동 삭제)
export async function removeAllFiles(postId) {
  const { data: files, error } = await listFiles(postId);
  if (error) throw error;
  if (files.length === 0) return;
  const { error: removeError } = await supabase.storage.from(BUCKET).remove(files.map((file) => file.path));
  if (removeError) throw removeError;
}

// ---------- 오늘의 수업·급식 자료 (선생님만 올림, content_files 표) ----------
// kind: 'lesson' | 'meal'   보관 위치: admin/kind/번호/무작위이름.확장자

const CONTENT_COLUMN = { lesson: 'lesson_id', meal: 'meal_id' };

async function uploadContentFile(kind, refId, file) {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  let mime = TYPES[extensionOf(file.name)];
  let blob = file;
  let name = file.name;
  if (isImage(mime)) ({ blob, mime, name } = await prepareImage(file, mime));
  if (blob.size > MAX_BYTES) throw new Error(`${file.name}: 50MB보다 커서 올릴 수 없어요.`);

  const path = `admin/${kind}/${refId}/${crypto.randomUUID()}.${extensionOf(name)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  if (uploadError) throw new Error(`${file.name}: 올리지 못했어요. (${uploadError.message})`);
  const { error } = await supabase.from('content_files').insert({ [CONTENT_COLUMN[kind]]: refId, path, name: name.slice(0, 200), size: blob.size, mime });
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(`${file.name}: 기록하지 못했어요.`);
  }
}

// 여러 자료 올리기 → 실패한 파일의 이유 목록
export async function uploadContentFiles(kind, refId, files, onProgress) {
  const failures = [];
  for (const [index, file] of files.entries()) {
    onProgress?.(`파일 올리는 중… (${index + 1}/${files.length})`);
    try {
      await uploadContentFile(kind, refId, file);
    } catch (error) {
      failures.push(error.message);
    }
  }
  return failures;
}

// 여러 수업(또는 급식)의 자료 → Map(번호 → [파일...])
export async function listContentFiles(kind, refIds) {
  const column = CONTENT_COLUMN[kind];
  const map = new Map(refIds.map((id) => [id, []]));
  if (refIds.length === 0) return map;
  const { data, error } = await supabase.from('content_files').select(`id, ${column}, path, name, size, mime`).in(column, refIds).order('id');
  if (error) {
    if (error.code === 'PGRST205') return map; // 표가 아직 없으면(SQL 실행 전) 자료 없음
    throw error;
  }
  for (const file of data) map.get(file[column])?.push(file);
  return map;
}

export async function removeContentFile(file) {
  const { data, error } = await supabase.storage.from(BUCKET).remove([file.path]);
  if (error) throw error;
  if (data.length === 0) throw new Error('지울 권한이 없어요.');
  const { error: rowError } = await supabase.from('content_files').delete().eq('id', file.id);
  if (rowError) throw rowError;
}

// 수업·급식을 지우기 전에 그 자료 파일을 보관함에서 모두 지움 (기록은 함께 자동 삭제)
export async function removeAllContentFiles(kind, refId) {
  const files = (await listContentFiles(kind, [refId])).get(refId) ?? [];
  if (files.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(files.map((file) => file.path));
  if (error) throw error;
}
