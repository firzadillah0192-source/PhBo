import React from 'react';
import { AppStep } from '../types';

interface ProgressIndicatorProps {
  currentStep: AppStep;
  mode: 'basic' | 'advanced';
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({ currentStep, mode }) => {
  if (currentStep === 'home') return null;

  const steps: { key: AppStep; label: string }[] = [
    { key: 'gallery', label: mode === 'basic' ? 'Studio' : 'World' },
    { key: 'capture', label: 'Photo' },
    { key: 'review', label: 'Review' },
    { key: 'processing', label: 'Create' },
    { key: 'result', label: 'Result' },
  ];

  const currentIndex = steps.findIndex((s) => s.key === currentStep);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
      <div className="flex items-center gap-2 sm:gap-3 px-4 py-2 rounded-full bg-white/80 backdrop-blur-md border border-[#E8E8E5] shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
        {steps.map((step, idx) => {
          const isActive = idx === currentIndex;
          const isPassed = idx < currentIndex;

          return (
            <React.Fragment key={step.key}>
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                    isActive
                      ? 'bg-[#6558FF] scale-125 ring-4 ring-[#6558FF]/20'
                      : isPassed
                      ? 'bg-[#111216]'
                      : 'bg-[#D1D5DB]'
                  }`}
                />
                <span
                  className={`text-[11px] uppercase tracking-wider transition-colors duration-200 ${
                    isActive
                      ? 'font-semibold text-[#111216]'
                      : isPassed
                      ? 'text-[#4B5563]'
                      : 'text-[#9CA3AF]'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {idx < steps.length - 1 && (
                <div
                  className={`w-4 h-[1px] transition-colors duration-300 ${
                    isPassed ? 'bg-[#111216]/40' : 'bg-[#E5E7EB]'
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
