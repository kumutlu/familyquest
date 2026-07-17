const fs = require('fs');
const path = 'src/components/requests/RequestDetail.test.tsx';
let s = fs.readFileSync(path, 'utf8');

const re = /it\('parent approver sees Approve and Reject \(not only Cancel\)', \(\) => \{[\s\S]*?\n  \}\)/;
if (!re.test(s)) { console.error('TEST1 REGEX NOT FOUND'); process.exit(2); }
s = s.replace(re, `  it('parent approver (who is the requested-from) sees Accept for a pending_acceptance request', () => {
    setCurrentUser({ id: 'parent-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' })
    render(<RequestDetailSheet request={moneyRequestPendingAcceptanceRaw} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Accept Request' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel Request' })).not.toBeInTheDocument()
  })`);

fs.writeFileSync(path, s);
console.log('patched RequestDetail.test.tsx (approver test)');
