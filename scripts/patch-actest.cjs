const fs = require('fs');
const path = 'src/components/parent/ApprovalCenter.test.tsx';
let s = fs.readFileSync(path, 'utf8');

// 1. Add acceptMoneyRequest to the api mock
const oldMock = `  approveMoneyRequest: vi.fn(), rejectMoneyRequest: vi.fn(),
  approvePetBoxDonation: vi.fn(), rejectPetBoxDonation: vi.fn(),`;
const newMock = `  approveMoneyRequest: vi.fn(), rejectMoneyRequest: vi.fn(), acceptMoneyRequest: vi.fn(),
  approvePetBoxDonation: vi.fn(), rejectPetBoxDonation: vi.fn(),`;
if (!s.includes(oldMock)) { console.error('MOCK NOT FOUND'); process.exit(2); }
s = s.replace(oldMock, newMock);

// 2. Update the "approving a pending_acceptance" test to use Accept
const oldApprove = `  it('approving a pending_acceptance money request removes it from Pending and updates the count', async () => {
    const pending = deferred();
    api.approveMoneyRequest.mockReturnValue(pending.promise);
    state.current = { ...baseState, moneyRequests: [moneyRequestPendingAcceptance] };
    renderApprovalCenter();

    expect(screen.getByText('Pending (1)')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' })[0]);
    expect(api.approveMoneyRequest).toHaveBeenCalledWith('family-1', 'mr-1');

    pending.resolve();
    await waitFor(() => expect(screen.getByText('Pending (0)')).toBeInTheDocument());
  });`;
const newApprove = `  it('accepting a pending_acceptance money request (requested-from is the parent) removes it from Pending', async () => {
    const pending = deferred();
    api.acceptMoneyRequest.mockReturnValue(pending.promise);
    state.current = { ...baseState, moneyRequests: [moneyRequestPendingAcceptance] };
    renderApprovalCenter();

    expect(screen.getByText('Pending (1)')).toBeInTheDocument();
    // A pending_acceptance request addressed to the current parent shows Accept,
    // not Approve (approving a pending_acceptance request is denied by the rules).
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(api.acceptMoneyRequest).toHaveBeenCalledWith('family-1', 'mr-1');

    pending.resolve();
    await waitFor(() => expect(screen.getByText('Pending (0)')).toBeInTheDocument());
  });

  it('a pending_acceptance money request does NOT render Approve (canonical contract)', () => {
    state.current = { ...baseState, moneyRequests: [moneyRequestPendingAcceptance] };
    renderApprovalCenter();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
  });`;
if (!s.includes(oldApprove)) { console.error('APPROVE TEST NOT FOUND'); process.exit(2); }
s = s.replace(oldApprove, newApprove);

fs.writeFileSync(path, s);
console.log('patched ApprovalCenter.test.tsx');
