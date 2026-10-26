/** Dollar cost, marked as a subtotal when some events had no known price. */
export function costLabel(cost: number, unpricedEvents = 0): string {
  return `$${cost.toFixed(2)}${unpricedEvents > 0 ? ' known subtotal' : ''}`;
}

/** Last path segment of a project directory. */
export const basename = (p: string) => p.split('/').filter(Boolean).pop() ?? p ?? '?';
