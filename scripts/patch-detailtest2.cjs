const fs = require('fs');
const path = 'src/components/requests/RequestDetail.test.tsx';
let s = fs.readFileSync(path, 'utf8');

// Replace the mobile footer test body using a regex anchored on the test name.
const re = /it\('mobile action footer stays visible \(sticky\) and shows the actions', \(\) => \{[\s\S]*?\n  \}\)/;
if (!re.test(s)) { console.error('REGEX NOT FOUND'); process.exit(2); }
s = s.replace(re, `  it('mobile action footer stays visible (sticky) and shows the Accept action', () => {
    setCurrentUser({ id: 'parent-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' })
    const { container } = render(<RequestDetailSheet request={moneyRequestPendingAcceptanceRaw} onClose={() => {}} />)
    expect(container.querySelector('.sticky.bottom-0')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Accept Request' })).toBeInTheDocument()
  })`);

fs.writeFileSync(path, s);
console.log('patched RequestDetail.test.tsx (footer test)');
