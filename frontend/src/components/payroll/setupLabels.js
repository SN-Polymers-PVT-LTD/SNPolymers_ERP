export const setupLabel = s => `${s.establishment_name} · ${s.state_name} · from ${s.effective_from}${s.effective_to ? ` to ${s.effective_to}` : ''}`;
