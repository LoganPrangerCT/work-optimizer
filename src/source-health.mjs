export const sources=['Blackboard','Gmail','Outlook'];
export const sourceCodeMessages = {
  reviewed: 'The requested source review completed.',
  scope_limited: 'The review covered only part of the available material.',
  pagination_incomplete: 'Additional results were not reviewed.',
  undated_work: 'Some undated work may be missing.',
  submission_unknown: 'Some submission statuses could not be verified.',
  attachments_unread: 'Some attachments or rubrics could not be read.',
  messages_unavailable: 'Course messages were unavailable.',
  login_required: 'Sign in to this source and refresh again.',
  profile_busy: 'The browser profile is busy; close the other session and retry.',
  unavailable: 'This source or its connector was unavailable.',
  tool_unavailable: 'The refresh worker could not access this source’s tool. Check that the app is enabled for Codex; this does not establish that the account is disconnected.',
  error: 'The source could not be checked due to an error.',
  not_checked: 'This source was not checked during the refresh.',
};
export function sourceReport(source, codes, checkedAt = new Date().toISOString()) {
  if (!Array.isArray(codes) || !codes.length || codes.some(code => !Object.hasOwn(sourceCodeMessages, code))) throw new Error('Invalid source health codes');
  const unique = [...new Set(codes)];
  const status = unique.some(code => ['login_required','profile_busy','unavailable'].includes(code)) ? 'blocked'
    : unique.some(code => ['error','not_checked','tool_unavailable'].includes(code)) ? 'error'
    : unique.includes('reviewed') ? 'reviewed' : 'error';
  return {source, status, checkedAt, note: unique.filter(code => code !== 'reviewed' || unique.length === 1).map(code => sourceCodeMessages[code]).join(' ')};
}
