// 자리(모둠) 뽑기 계산 — 화면과 상관없는 순수 함수만 (테스트하기 쉽게)

// 인원과 모둠 크기 → 모둠별 인원 (예: 23명, 4명 → [4,4,4,4,4,3] / 24명 → [4,4,4,4,4,4])
export function groupSizes(count, size) {
  if (count <= 0) return [];
  const groups = Math.ceil(count / size);
  const base = Math.floor(count / groups);
  const extra = count % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}

// 금지 묶음 → "이 두 사람은 같은 모둠 안 됨" 집합 (키: "id1|id2")
export function forbiddenPairs(rules) {
  const pairs = new Set();
  for (const rule of rules) {
    const ids = rule.member_ids;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        pairs.add([ids[i], ids[j]].sort().join('|'));
      }
    }
  }
  return pairs;
}

function clashes(group, id, pairs) {
  return group.some((other) => pairs.has([other, id].sort().join('|')));
}

function shuffle(list, random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// 랜덤 뽑기: 금지 조건을 지키는 배치를 찾을 때까지 여러 번 시도
//   ids: 학생 ID 목록, size: 모둠 크기, rules: 금지 묶음
//   → { groups: [[id...], ...] } 또는 { error: '...' }
export function drawGroups(ids, size, rules, random = Math.random, tries = 3000) {
  const sizes = groupSizes(ids.length, size);
  const pairs = forbiddenPairs(rules);
  // 금지 조건이 많은 학생부터 넣으면 더 잘 찾아짐
  const weight = new Map(ids.map((id) => [id, [...pairs].filter((p) => p.split('|').includes(id)).length]));

  for (let attempt = 0; attempt < tries; attempt++) {
    const order = shuffle(ids, random).sort((a, b) => weight.get(b) - weight.get(a));
    const groups = sizes.map(() => []);
    let ok = true;
    for (const id of order) {
      const open = shuffle(
        groups.map((g, i) => i).filter((i) => groups[i].length < sizes[i] && !clashes(groups[i], id, pairs)),
        random,
      );
      if (!open.length) {
        ok = false;
        break;
      }
      groups[open[0]].push(id);
    }
    if (ok) return { groups: shuffle(groups, random) };
  }
  return { error: '조건을 모두 지키는 배치를 찾지 못했어요. "같은 모둠 금지" 묶음을 줄여 주세요.' };
}

// 지금 배치에서 금지 조건을 어긴 모둠 번호들
export function violations(groups, rules) {
  const pairs = forbiddenPairs(rules);
  const bad = new Set();
  groups.forEach((group, i) => {
    group.forEach((id, j) => {
      if (clashes(group.slice(j + 1), id, pairs)) bad.add(i);
    });
  });
  return bad;
}
