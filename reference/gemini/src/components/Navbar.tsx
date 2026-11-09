import React from 'react';
import { Sparkles, Camera, ShieldCheck, User } from 'lucide-react';
import { AppMode, AppStep, QuotaState } from '../types';

interface NavbarProps {
  currentMode: AppMode;
  currentStep: AppStep;
  quota: QuotaState;
  onNavigateHome: () => void;
  onSelectMode: (mode: 'basic' | 'advanced') => void;
  onOpenCreditsModal: () => void;
  onResetToMode: (mode: 'basic' | 'advanced') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentMode,
  currentStep,
  quota,
  onNavigateHome,
  onSelectMode,
  onOpenCreditsModal,
}) => {
  return (
    <header className="fixed top-0 left-0 right-0 z-40 transition-all duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
        
        {/* BRAND / LOGO */}
        <button
          id="nav-logo-btn"
          onClick={onNavigateHome}
          className="group flex items-center gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6558FF]/50 rounded-lg p-1 transition-transform active:scale-95"
        >
          <div className="w-9 h-9 rounded-full bg-[#111216] flex items-center justify-center text-white shadow-sm group-hover:scale-105 transition-transform duration-300">
            <span className="font-editorial text-lg italic tracking-wider">P</span>
          </div>
          <div>
            <span className="font-sans-clean font-semibold tracking-wider text-xs sm:text-sm text-[#111216] uppercase block">
              Photobooth AI
            </span>
            <span className="text-[10px] tracking-widest text-[#787B86] uppercase block -mt-0.5">
              Celestial Studio
            </span>
          </div>
        </button>

        {/* CENTER MODE TOGGLES */}
        <nav className="flex items-center p-1 rounded-full bg-white/70 backdrop-blur-md border border-[#E8E8E5]/80 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <button
            id="nav-mode-basic-btn"
            onClick={() => onSelectMode('basic')}
            className={`px-4 py-1.5 rounded-full text-xs font-medium tracking-wide transition-all duration-200 flex items-center gap-1.5 ${
              currentMode === 'basic' && currentStep !== 'home'
                ? 'bg-[#111216] text-white shadow-sm'
                : 'text-[#252830] hover:text-[#111216] hover:bg-[#EEF2F5]/60'
            }`}
          >
            <Camera className="w-3.5 h-3.5 opacity-75" />
            <span>Basic Studio</span>
          </button>

          <button
            id="nav-mode-advanced-btn"
            onClick={() => onSelectMode('advanced')}
            className={`px-4 py-1.5 rounded-full text-xs font-medium tracking-wide transition-all duration-200 flex items-center gap-1.5 ${
              currentMode === 'advanced' && currentStep !== 'home'
                ? 'bg-[#6558FF] text-white shadow-sm'
                : 'text-[#252830] hover:text-[#111216] hover:bg-[#EEF2F5]/60'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 opacity-75" />
            <span>AI Worlds</span>
          </button>
        </nav>

        {/* RIGHT: QUOTA & ACCOUNT */}
        <div className="flex items-center gap-3">
          <button
            id="nav-quota-badge"
            onClick={onOpenCreditsModal}
            className="group px-3 py-1.5 rounded-full bg-white/75 backdrop-blur-sm border border-[#E8E8E5] text-xs font-medium text-[#252830] flex items-center gap-2 hover:border-[#6558FF]/40 transition-colors shadow-xs"
            title="View AI Generations Quota"
          >
            <span className="w-2 h-2 rounded-full bg-[#6558FF] animate-pulse" />
            <span className="font-semibold text-[#111216]">{quota.aiCredits}</span>
            <span className="text-[#787B86] hidden sm:inline">AI credits</span>
          </button>

          <button
            id="nav-account-btn"
            onClick={onOpenCreditsModal}
            className="w-9 h-9 rounded-full bg-white/75 backdrop-blur-sm border border-[#E8E8E5] flex items-center justify-center text-[#252830] hover:border-[#111216] transition-colors focus:outline-none"
            aria-label="Account details"
          >
            <User className="w-4 h-4" />
          </button>
        </div>

      </div>
    </header>
  );
};
