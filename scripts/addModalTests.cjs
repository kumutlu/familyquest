const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src/components/profile/ProfileEditorModal.test.tsx');
const lines = fs.readFileSync(file, 'utf8').split('\n');

// Replace the last 42 appended lines (the 3 new tests) with corrected versions.
// The file originally ended at line 120 (before our append). We appended 42
// lines, so the new tests occupy lines 121..162. Replace 121..162.
const start = 121;
const end = 162;

const clean = [
  "  it('child with no avatar: display-name-only submit sends null avatarId (root-cause payload)', async () => {",
  "    const user = userEvent.setup()",
  "    // A child with avatarId: null reproduces the exact production payload that",
  "    // previously triggered a Firestore evaluation error (requestedAvatarId: null).",
  "    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: null, rewardPoints: 500, familyId: 'f1' })",
  "    const nameInput = screen.getByLabelText('Display Name')",
  "    await user.clear(nameInput)",
  "    await user.type(nameInput, 'Muhammed')",
  "    await user.click(screen.getByRole('button', { name: 'Submit for approval' }))",
  "    await waitFor(() => expect(submitMock).toHaveBeenCalled())",
  "    const callArgs = submitMock.mock.calls[0]",
  "    expect(callArgs[1]).toBe('Muhammed')",
  "    expect(callArgs[2]).toBeNull()",
  "  })",
  '',
  "  it('preserves entered changes after a failed submit (no data loss)', async () => {",
  "    const user = userEvent.setup()",
  "    submitMock.mockRejectedValueOnce(new Error('Network error'))",
  "    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })",
  "    const nameInput = screen.getByLabelText('Display Name')",
  "    await user.clear(nameInput)",
  "    await user.type(nameInput, 'Muhammed Jr')",
  "    await user.click(screen.getByRole('button', { name: 'Submit for approval' }))",
  "    await waitFor(() => expect(screen.getAllByText(/Network error/i).length).toBeGreaterThan(0))",
  "    // The typed value is still in the input — the child can retry without retyping.",
  "    expect((screen.getByLabelText('Display Name') as HTMLInputElement).value).toBe('Muhammed Jr')",
  "  })",
  '',
  "  it('maps a permission-denied error to a child-safe message (no raw internals)', async () => {",
  "    const user = userEvent.setup()",
  "    submitMock.mockRejectedValueOnce({ code: 'permission-denied', message: 'Missing or insufficient permissions.' })",
  "    renderModal({ id: 'c1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: '', avatarId: 'starter-cat', rewardPoints: 500, familyId: 'f1' })",
  "    const nameInput = screen.getByLabelText('Display Name')",
  "    await user.clear(nameInput)",
  "    await user.type(nameInput, 'Muhammed Jr')",
  "    await user.click(screen.getByRole('button', { name: 'Submit for approval' }))",
  "    await waitFor(() => expect(screen.getAllByText(/parent/i).length).toBeGreaterThan(0))",
  "    expect(screen.queryByText(/permission/i)).toBeNull()",
  "  })",
  '',
];

const before = lines.slice(0, start - 1);
const after = lines.slice(end);
const out = before.concat(clean, after);
fs.writeFileSync(file, out.join('\n'));
console.log('Replaced lines', start, '-', end, 'with', clean.length, 'corrected tests.');
