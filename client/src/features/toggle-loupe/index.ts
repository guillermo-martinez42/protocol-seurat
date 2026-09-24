export function toggle(b: boolean): boolean {
  return !b;
}

export function pillStyle(on: boolean): { bg: string; fg: string; r: string } {
  return on
    ? { bg: '#B8C4FF', fg: '#1F2D6F', r: '16px' }
    : { bg: 'transparent', fg: '#E3E1E9', r: '24px' };
}
