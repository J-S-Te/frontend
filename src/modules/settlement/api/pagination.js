export function listQuery({ limit = 50, offset = 0 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new Error("分页参数无效");
  return `?limit=${limit}&offset=${offset}`;
}
