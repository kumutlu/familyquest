import type { ReactNode } from 'react';

interface OnboardingActionsProps {
  primary: ReactNode;
  secondary?: ReactNode;
  tertiary?: ReactNode;
}

export function OnboardingActions({ primary, secondary, tertiary }: OnboardingActionsProps) {
  return (
    <div className="mt-7 space-y-3">
      <div className="flex flex-col-reverse gap-3 min-[400px]:flex-row min-[400px]:items-center">
        {secondary ? <div className="min-[400px]:shrink-0">{secondary}</div> : null}
        <div className="flex-1">{primary}</div>
      </div>
      {tertiary ? <div className="text-center">{tertiary}</div> : null}
    </div>
  );
}
