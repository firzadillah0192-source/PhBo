import React, { useState } from 'react';
import { X, Sparkles, Check, Gift, Shield } from 'lucide-react';
import { QuotaState } from '../types';

interface CreditsModalProps {
  isOpen: boolean;
  quota: QuotaState;
  onClose: () => void;
  onClaimSignupBonus: () => void;
  onAddDemoCredits: () => void;
}

export const CreditsModal: React.FC<CreditsModalProps> = ({
  isOpen,
  quota,
  onClose,
  onClaimSignupBonus,
  onAddDemoCredits,
}) => {
  const [emailInput, setEmailInput] = useState('');
  const [claimedSuccess, setClaimedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSignup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput || !emailInput.includes('@')) return;
    onClaimSignupBonus();
    setClaimedSuccess(true);
    setTimeout(() => {
      setClaimedSuccess(false);
      onClose();
    }, 1400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in select-none">
      <div className="relative w-full max-w-md bg-white rounded-3xl p-6 sm:p-8 shadow-[0_25px_60px_rgba(0,0,0,0.15)] border border-[#E8E8E5]">
        
        {/* CLOSE BUTTON */}
        <button
          id="credits-modal-close-btn"
          onClick={onClose}
          className="absolute top-5 right-5 w-8 h-8 rounded-full bg-[#F7F7F5] flex items-center justify-center text-[#787B86] hover:text-[#111216] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* HEADER */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-[#6558FF]/10 text-[#6558FF] flex items-center justify-center mx-auto mb-3">
            <Sparkles className="w-6 h-6" />
          </div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-[#787B86]">
            Celestial Studio Quota
          </span>
          <h3 className="font-editorial text-3xl text-[#111216] font-normal tracking-tight mt-1">
            {quota.aiCredits} AI Credits
          </h3>
          <p className="text-xs text-[#6B7280] mt-1">
            {quota.isRegistered ? 'Member Account Verified' : 'Anonymous Visitor Session'}
          </p>
        </div>

        {/* DETAILS LIST */}
        <div className="space-y-3 mb-6 bg-[#F7F7F5] p-4 rounded-2xl border border-[#E8E8E5]/80 text-xs text-[#252830]">
          <div className="flex items-center justify-between">
            <span className="text-[#6B7280]">Basic Studio Generations</span>
            <span className="font-semibold text-[#7FA685]">Always Free (Unlimited)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#6B7280]">AI World Generations</span>
            <span className="font-semibold text-[#111216]">1 Credit / Portrait</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#6B7280]">Total Portraits Created</span>
            <span className="font-mono font-semibold">{quota.totalGenerated}</span>
          </div>
        </div>

        {/* CLAIM SIGNUP BONUS (IF NOT REGISTERED) */}
        {!quota.isRegistered ? (
          <div className="border-t border-[#F0F0EE] pt-5">
            <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-[#111216]">
              <Gift className="w-4 h-4 text-[#6558FF]" />
              <span>Claim +5 Free AI Credits</span>
            </div>
            <p className="text-[11px] text-[#6B7280] mb-3">
              Get an instant complimentary grant of 5 high-definition AI world transformations.
            </p>

            {claimedSuccess ? (
              <div className="py-2.5 px-4 rounded-full bg-[#7FA685]/15 text-[#7FA685] text-xs font-semibold text-center flex items-center justify-center gap-1.5">
                <Check className="w-4 h-4" />
                <span>+5 Credits Added to your Studio!</span>
              </div>
            ) : (
              <form onSubmit={handleSignup} className="space-y-3">
                <input
                  type="email"
                  placeholder="Enter email address"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-full border border-[#E8E8E5] text-xs text-[#111216] placeholder-[#9CA3AF] focus:outline-none focus:border-[#6558FF]"
                  required
                />
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-full bg-[#111216] text-white text-xs font-semibold uppercase tracking-wider hover:bg-[#6558FF] transition-colors"
                >
                  Activate +5 Credits
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="border-t border-[#F0F0EE] pt-4 text-center">
            <button
              onClick={onAddDemoCredits}
              className="text-xs text-[#6558FF] hover:underline font-medium"
            >
              + Add 3 test credits (Kiosk demo mode)
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
