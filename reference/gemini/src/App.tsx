import React, { useState } from 'react';
import { CelestialCanvas } from './components/CelestialCanvas';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { BasicGallery } from './components/BasicGallery';
import { AdvancedGallery } from './components/AdvancedGallery';
import { CaptureStage } from './components/CaptureStage';
import { ReviewStage } from './components/ReviewStage';
import { ProcessingStage } from './components/ProcessingStage';
import { ResultStage } from './components/ResultStage';
import { ProgressIndicator } from './components/ProgressIndicator';
import { CreditsModal } from './components/CreditsModal';
import {
  AppMode,
  AppStep,
  StudioTemplate,
  AIExperience,
  UserPhoto,
  GenerationResult,
  QuotaState,
} from './types';
import { EXPERIENCES } from './data/experiences';
import { AlertCircle } from 'lucide-react';

export default function App() {
  const [currentMode, setCurrentMode] = useState<AppMode>('home');
  const [currentStep, setCurrentStep] = useState<AppStep>('home');
  const [hoveredMode, setHoveredMode] = useState<'basic' | 'advanced' | null>(null);

  const [selectedTemplate, setSelectedTemplate] = useState<StudioTemplate | undefined>(undefined);
  const [selectedExperience, setSelectedExperience] = useState<AIExperience | undefined>(undefined);
  const [userPhoto, setUserPhoto] = useState<UserPhoto | null>(null);
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(null);

  const [quota, setQuota] = useState<QuotaState>({
    aiCredits: 2,
    totalGenerated: 0,
    isRegistered: false,
  });

  const [creditsModalOpen, setCreditsModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Mode Selection Handlers
  const handleSelectMode = (mode: 'basic' | 'advanced') => {
    setCurrentMode(mode);
    setCurrentStep('gallery');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNavigateHome = () => {
    setCurrentMode('home');
    setCurrentStep('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleQuickExploreExperience = (expId: string) => {
    const exp = EXPERIENCES.find((e) => e.id === expId) || EXPERIENCES[0];
    setSelectedExperience(exp);
    setCurrentMode('advanced');
    setCurrentStep('capture');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Gallery Selection
  const handleSelectTemplate = (template: StudioTemplate) => {
    setSelectedTemplate(template);
    setCurrentStep('capture');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectExperience = (experience: AIExperience) => {
    setSelectedExperience(experience);
    setCurrentStep('capture');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Capture Completion
  const handlePhotoCaptured = (photo: UserPhoto) => {
    setUserPhoto(photo);
    setCurrentStep('review');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Review Stage -> Start Generation
  const handleStartProcessing = () => {
    if (currentMode === 'advanced') {
      if (quota.aiCredits <= 0) {
        setCreditsModalOpen(true);
        return;
      }
      setQuota((prev) => ({
        ...prev,
        aiCredits: Math.max(0, prev.aiCredits - 1),
        totalGenerated: prev.totalGenerated + 1,
      }));
    } else {
      setQuota((prev) => ({
        ...prev,
        totalGenerated: prev.totalGenerated + 1,
      }));
    }

    setErrorMessage(null);
    setCurrentStep('processing');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Processing Completed
  const handleGenerationComplete = (result: GenerationResult) => {
    setGenerationResult(result);
    setCurrentStep('result');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleGenerationFailed = (msg: string) => {
    setErrorMessage(msg);
  };

  // Result Actions
  const handleCreateAnother = () => {
    setUserPhoto(null);
    setGenerationResult(null);
    setCurrentStep('gallery');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleTryAnotherLook = () => {
    // Keep userPhoto intact, return to gallery to pick another style
    setGenerationResult(null);
    setCurrentStep('gallery');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Quota Modifiers
  const handleClaimSignupBonus = () => {
    setQuota((prev) => ({
      ...prev,
      aiCredits: prev.aiCredits + 5,
      isRegistered: true,
    }));
  };

  const handleAddDemoCredits = () => {
    setQuota((prev) => ({
      ...prev,
      aiCredits: prev.aiCredits + 3,
    }));
  };

  return (
    <div className="relative min-h-screen font-sans-clean text-[#111216] bg-[#F7F7F5] selection:bg-[#6558FF]/20 selection:text-[#111216] overflow-x-hidden">
      
      {/* 1. CINEMATIC LIVING CELESTIAL BACKGROUND CANVAS */}
      <CelestialCanvas
        currentMode={currentMode}
        hoveredMode={hoveredMode}
        currentStep={currentStep}
      />

      {/* 2. MINIMAL LUXURY EDITORIAL NAVBAR */}
      <Navbar
        currentMode={currentMode}
        currentStep={currentStep}
        quota={quota}
        onNavigateHome={handleNavigateHome}
        onSelectMode={handleSelectMode}
        onResetToMode={handleSelectMode}
        onOpenCreditsModal={() => setCreditsModalOpen(true)}
      />

      {/* 3. GRACEFUL ERROR STATE (IF ANY) */}
      {errorMessage && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 max-w-md w-full px-4">
          <div className="bg-white/95 backdrop-blur-md rounded-2xl p-4 shadow-xl border border-[#F3B587] flex items-start gap-3 text-xs">
            <AlertCircle className="w-5 h-5 text-[#F3B587] shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold text-[#111216] block">
                We couldn't load the studio.
              </span>
              <p className="text-[#6B7280] mt-0.5">{errorMessage}</p>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="px-3 py-1 rounded-full bg-[#111216] text-white text-[10px] font-semibold uppercase tracking-wider"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* 4. ACTIVE FLOW STAGE */}
      <main className="relative z-10">
        {currentStep === 'home' && (
          <HeroSection
            onSelectMode={handleSelectMode}
            onHoverMode={setHoveredMode}
            onQuickExploreExperience={handleQuickExploreExperience}
          />
        )}

        {currentStep === 'gallery' && currentMode === 'basic' && (
          <BasicGallery
            onSelectTemplate={handleSelectTemplate}
            onBackToHome={handleNavigateHome}
          />
        )}

        {currentStep === 'gallery' && currentMode === 'advanced' && (
          <AdvancedGallery
            onSelectExperience={handleSelectExperience}
            onBackToHome={handleNavigateHome}
          />
        )}

        {currentStep === 'capture' && (
          <CaptureStage
            mode={currentMode === 'basic' ? 'basic' : 'advanced'}
            selectedTemplate={selectedTemplate}
            selectedExperience={selectedExperience}
            onPhotoCaptured={handlePhotoCaptured}
            onBackToGallery={() => setCurrentStep('gallery')}
          />
        )}

        {currentStep === 'review' && userPhoto && (
          <ReviewStage
            mode={currentMode === 'basic' ? 'basic' : 'advanced'}
            userPhoto={userPhoto}
            selectedTemplate={selectedTemplate}
            selectedExperience={selectedExperience}
            quota={quota}
            onStartProcessing={handleStartProcessing}
            onBackToCapture={() => setCurrentStep('capture')}
          />
        )}

        {currentStep === 'processing' && userPhoto && (
          <ProcessingStage
            mode={currentMode === 'basic' ? 'basic' : 'advanced'}
            userPhoto={userPhoto}
            selectedTemplate={selectedTemplate}
            selectedExperience={selectedExperience}
            onGenerationComplete={handleGenerationComplete}
            onGenerationFailed={handleGenerationFailed}
          />
        )}

        {currentStep === 'result' && generationResult && (
          <ResultStage
            result={generationResult}
            onCreateAnother={handleCreateAnother}
            onTryAnotherLook={handleTryAnotherLook}
          />
        )}
      </main>

      {/* 5. MINIMAL STAGE PROGRESS INDICATOR */}
      <ProgressIndicator
        currentStep={currentStep}
        mode={currentMode === 'basic' ? 'basic' : 'advanced'}
      />

      {/* 6. CREDITS & ACCOUNT MODAL */}
      <CreditsModal
        isOpen={creditsModalOpen}
        quota={quota}
        onClose={() => setCreditsModalOpen(false)}
        onClaimSignupBonus={handleClaimSignupBonus}
        onAddDemoCredits={handleAddDemoCredits}
      />

    </div>
  );
}
