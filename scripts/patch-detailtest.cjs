const fs = require('fs');
const path = 'src/components/requests/RequestDetail.test.tsx';
let s = fs.readFileSync(path, 'utf8');

// Test 1: parent approver sees Approve and Reject (not only Cancel) -> now Accept for pending_acceptance
const old1 = `  it('parent approver sees Approve and Reject (not only Cancel)', () => {
    setCurrentUser({ id: 'parent-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' })
    render(<RequestDetailSheet request={moneyRequestPendingAcceptanceRaw} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel Request' })).not.toBeInTheDocument()
  })`;
const new1 = `  it('parent approver (who is the requested-from) sees Accept for a pending_acceptance request', () => {
    setCurrentUser({ id: 'parent-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' })
    render(<RequestDetailSheet request={moneyRequestPendingAcceptanceRaw} onClose={() => {}} />)
    // A pending_acceptance request addressed to the current parent shows Accept
    // (approving a pending_acceptance request is denied by the rules), not Approve.
    expect(screen.getByRole('button', { name: 'Accept Request' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel Request' })).not.toBeInTheDocument()
  })`;
if (!s.includes(old1)) { console.error('TEST1 NOT FOUND'); process.exit(2); }
s = s.replace(old1, new1);

// Test 2: mobile action footer stays visible and shows the actions
const old2 = `  it('mobile action footer stays visible (sticky) and shows the actions', () => {
    setCurrentUser({ id: 'parent-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' })
    const { container } = render(<RequestDetailSheet request={moneyRequestPendingAcceptanceRaw} onClose={() => {}} />)
    expect(container.querySelector('.sticky.bottom-0')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
  })`;
const new2 = `  it('mobile action footer stays visible (sticky) and shows the Accept action', () => {
    setCurrentUser({ id: 'parent-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' })
    const { container } = render(<RequestDetailSheet request={moneyRequestPendingAcceptanceRaw} onClose={() => {}} />)
    expect(container.querySelector('.sticky.bottom-0')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Accept Request' })).toBeInTheDocument()
  })`;
if (!s.includes(old2)) { console.error('TEST2 NOT FOUND'); process.exit(2); }
s = s.replace(old2, new2);

fs.writeFileSync(path, s);
console.log('patched RequestDetail.test.tsx');
