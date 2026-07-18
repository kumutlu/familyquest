import { Send, HandCoins } from 'lucide-react';

interface QuickActionsProps {
  onSend: () => void;
  onRequest: () => void;
  requestDisabled?: boolean;
  requestHint?: string;
}

// Primary child actions shown directly below the balance card.
export function QuickActions({ onSend, onRequest, requestDisabled, requestHint }: QuickActionsProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <button
        type="button"
        onClick={onSend}
        className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-primary-600 px-4 py-4 text-white shadow-sm transition-all hover:bg-primary-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
        aria-label="Send Money"
      >
        <Send size={22} aria-hidden="true" />
        <span className="text-sm font-semibold">Send Money</span>
      </button>
      <button
        type="button"
        onClick={onRequest}
        disabled={requestDisabled}
        className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-white px-4 py-4 text-gray-900 shadow-sm border border-gray-200 transition-all hover:border-primary-300 hover:text-primary-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none"
        aria-label="Request Money"
      >
        <HandCoins size={22} aria-hidden="true" />
        <span className="text-sm font-semibold">Request Money</span>
      </button>
      {requestHint && (
        <p className="col-span-2 text-xs text-gray-400">{requestHint}</p>
      )}
    </div>
  );
}
