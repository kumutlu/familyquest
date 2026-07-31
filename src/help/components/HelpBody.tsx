import { useTranslation } from 'react-i18next';
import { AlertTriangle, Info, Lightbulb, Clock } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { HelpBlock, HelpCalloutTone, HelpSection } from '../types';

const TONE_STYLES: Record<HelpCalloutTone, { wrapper: string; icon: typeof Info }> = {
  tip: { wrapper: 'bg-emerald-50 border-emerald-200 text-emerald-900', icon: Lightbulb },
  info: { wrapper: 'bg-blue-50 border-blue-200 text-blue-900', icon: Info },
  warning: { wrapper: 'bg-amber-50 border-amber-200 text-amber-900', icon: AlertTriangle },
  comingSoon: { wrapper: 'bg-purple-50 border-purple-200 text-purple-900', icon: Clock },
};

export function HelpCallout({ tone, children }: { tone: HelpCalloutTone; children: React.ReactNode }) {
  const { t } = useTranslation('help');
  const { wrapper, icon: Icon } = TONE_STYLES[tone];
  return (
    <div className={cn('flex gap-3 rounded-xl border p-4 text-sm', wrapper)} role="note">
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div>
        <span className="mr-1 font-semibold">{t(`callouts.${tone}`)}:</span>
        {children}
      </div>
    </div>
  );
}

function Block({ block }: { block: HelpBlock }) {
  switch (block.kind) {
    case 'paragraph':
      return <p className="text-[15px] leading-7 text-gray-700">{block.text}</p>;

    case 'list': {
      const items = block.items.map(item => (
        <li key={item} className="text-[15px] leading-7 text-gray-700">
          {item}
        </li>
      ));
      return block.ordered ? (
        <ol className="ml-5 list-decimal space-y-1">{items}</ol>
      ) : (
        <ul className="ml-5 list-disc space-y-1">{items}</ul>
      );
    }

    case 'steps':
      return (
        <ol className="space-y-3">
          {block.steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700"
              >
                {index + 1}
              </span>
              <div>
                <p className="font-medium text-gray-900">{step.title}</p>
                {step.detail ? (
                  <p className="text-sm leading-6 text-gray-600">{step.detail}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      );

    case 'callout':
      return <HelpCallout tone={block.tone}>{block.text}</HelpCallout>;

    case 'faq':
      return (
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-100">
          {block.items.map(item => (
            <details key={item.q} className="group p-4">
              <summary className="cursor-pointer list-none font-medium text-gray-900 marker:hidden">
                {item.q}
              </summary>
              <p className="mt-2 text-[15px] leading-7 text-gray-700">{item.a}</p>
            </details>
          ))}
        </div>
      );

    default:
      return null;
  }
}

export function HelpBody({ sections }: { sections: HelpSection[] }) {
  return (
    <div className="space-y-10">
      {sections.map(section => (
        <section key={section.id} id={`section-${section.id}`} className="scroll-mt-24 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">{section.heading}</h2>
          {section.blocks.map((block, index) => (
            <Block key={`${section.id}-${index}`} block={block} />
          ))}
        </section>
      ))}
    </div>
  );
}
