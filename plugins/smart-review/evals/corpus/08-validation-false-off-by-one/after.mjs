// Page slice. Pages are 1-indexed.
// Array.prototype.slice's end is exclusive, so start + size is the first index
// not included. A full page has length === size.
export function slicePage(items, page, size) {
  const start = (page - 1) * size;
  return items.slice(start, start + size);
}
