export function countdown(from) {
  let steps = 0;
  while (from > 0) {
    from--;
    steps++;
  }
  return steps;
}
