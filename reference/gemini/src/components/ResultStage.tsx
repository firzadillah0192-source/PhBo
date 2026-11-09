import React, { useState, useEffect } from 'react';
import { Download, Share2, RefreshCw, Sparkles, SlidersHorizontal, Check } from 'lucide-react';
import confetti from 'canvas-confetti';
import { GenerationResult } from '../types';

interface ResultStageProps {
  result: GenerationResult;
  onCreateAnother: () => void;
  onTryAnotherLook: () => void;
}

export const ResultStage: React.FC<ResultStageProps> = ({
  result,
  onCreateAnother,
  onTryAnotherLook,
}) => {
  const [showOriginal, setShowOriginal] = useState<boolean>(false);
  const [compareSplit, setCompareSplit] = useState<number>(50); // percentage for split slider
  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [revealReady, setRevealReady] = useState<boolean>(false);

  useEffect(() => {
    // Cinematic reveal timing
    const timer = setTimeout(() => {
      setRevealReady(true);
      // Gentle celebratory burst
      confetti({
        particleCount: 45,
        spread: 70,
        origin: { y: 0.65 },
        colors: ['#6558FF', '#9CC8FF', '#F3B587', '#7FA685'],
        disableForReducedMotion: true,
      });
    }, 300);

    return () => clearTimeout(timer);
  }, []);

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = result.imageUrl;
    const cleanTitle = result.experienceTitle.toLowerCase().replace(/[^a-z0-9]/g, '-');
    link.download = `photobooth-${cleanTitle}-${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'My Photobooth AI Portrait',
          text: `Transformed in the ${result.experienceTitle} aesthetic on Photobooth AI.`,
          url: window.location.href,
        });
        return;
      } catch {
        // Fallback to copy URL
      }
    }
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="min-h-screen pt-24 pb-28 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto flex flex-col items-center select-none">
      
      {/* MINIMAL TOP CHROME */}
      <div className="w-full flex items-center justify-between mb-6">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-[#787B86] block">
            Celestial Master Print
          </span>
          <h2 className="font-editorial text-3xl sm:text-4xl text-[#111216] font-normal tracking-tight">
            {result.experienceTitle}
          </h2>
        </div>

        {/* COMPARISON SLIDER TOGGLE */}
        <button
          id="result-compare-toggle-btn"
          onClick={() => setIsComparing(!isComparing)}
          className={`px-4 py-2 rounded-full text-xs font-semibold tracking-wider uppercase transition-all flex items-center gap-1.5 ${
            isComparing
              ? 'bg-[#111216] text-white'
              : 'bg-white/80 border border-[#E8E8E5] text-[#252830] hover:border-[#111216]'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>{isComparing ? 'Close Split' : 'Compare Before/After'}</span>
        </button>
      </div>

      {/* HERO REVEAL PHOTOGRAPH CONTAINER (DOMINATES VIEWPORT) */}
      <div
        className={`relative w-full max-w-xl aspect-[3/4] rounded-3xl overflow-hidden shadow-[0_30px_70px_rgba(0,0,0,0.12)] border border-white/60 bg-[#111216] transition-all duration-1000 ${
          revealReady ? 'scale-100 opacity-100' : 'scale-95 opacity-0 blur-md'
        }`}
      >
        {isComparing ? (
          /* INTERACTIVE SPLIT COMPARISON SLIDER */
          <div className="relative w-full h-full select-none touch-none">
            {/* Transformed Result (Right / Base) */}
            <img
              src={result.imageUrl}
              alt="Transformed Portrait"
              className="absolute inset-0 w-full h-full object-cover"
            />

            {/* Original Portrait (Left / Clipped) */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${compareSplit}%` }}
            >
              <img
                src={result.originalPhotoUrl}
                alt="Original Portrait"
                className="absolute inset-0 w-full h-full object-cover max-w-none"
                style={{ width: '100%', height: '100%' }}
              />
              <div className="absolute top-4 left-4 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md text-[10px] uppercase font-semibold text-white">
                Before
              </div>
            </div>

            {/* Split Divider Handle */}
            <div
              className="absolute top-0 bottom-0 w-1 bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)] cursor-ew-resize flex items-center justify-center -ml-0.5"
              style={{ left: `${compareSplit}%` }}
            >
              <div className="w-8 h-8 rounded-full bg-white text-[#111216] shadow-lg flex items-center justify-center text-xs font-bold">
                ↔
              </div>
            </div>

            {/* Invisible Range Slider */}
            <input
              type="range"
              min={0}
              max={100}
              value={compareSplit}
              onChange={(e) => setCompareSplit(Number(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-20"
            />

            <div className="absolute top-4 right-4 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md text-[10px] uppercase font-semibold text-white pointer-events-none">
              After
            </div>
          </div>
        ) : (
          /* STANDARD FULL RESULT VIEW */
          <div className="relative w-full h-full group">
            <img
              src={showOriginal ? result.originalPhotoUrl : result.imageUrl}
              alt="Final Masterpiece"
              className="w-full h-full object-cover transition-all duration-500"
            />

            {/* Soft Ambient Environmental Light sweep */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none" />

            {/* Hold to compare button in corner */}
            <button
              id="result-hold-original-btn"
              onMouseDown={() => setShowOriginal(true)}
              onMouseUp={() => setShowOriginal(false)}
              onTouchStart={() => setShowOriginal(true)}
              onTouchEnd={() => setShowOriginal(false)}
              className="absolute bottom-4 left-4 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-white text-[11px] font-medium tracking-wide active:scale-95 transition-transform"
            >
              {showOriginal ? 'Showing Original' : 'Hold to View Original'}
            </button>

            <div className="absolute bottom-4 right-4 px-3 py-1.5 rounded-full bg-white/80 backdrop-blur-md text-[#111216] text-[10px] uppercase font-mono tracking-widest">
              Hi-Res Studio Master
            </div>
          </div>
        )}
      </div>

      {/* PRIMARY & SECONDARY ACTIONS */}
      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4 w-full max-w-xl">
        {/* PRIMARY: DOWNLOAD */}
        <button
          id="result-download-btn"
          onClick={handleDownload}
          className="w-full sm:w-auto flex-1 px-8 py-4 rounded-full bg-[#111216] hover:bg-[#6558FF] text-white text-xs font-semibold uppercase tracking-wider shadow-lg hover:shadow-xl hover:scale-105 active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Download High-Res Portrait</span>
        </button>

        {/* SHARE */}
        <button
          id="result-share-btn"
          onClick={handleShare}
          className="px-5 py-4 rounded-full bg-white/80 backdrop-blur-md border border-[#E8E8E5] hover:border-[#111216] text-[#252830] text-xs font-semibold uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-xs"
        >
          {copied ? <Check className="w-4 h-4 text-[#7FA685]" /> : <Share2 className="w-4 h-4" />}
          <span>{copied ? 'Link Copied' : 'Share'}</span>
        </button>
      </div>

      {/* SECONDARY NAVIGATION ACTIONS */}
      <div className="mt-6 flex items-center gap-6 text-xs font-semibold tracking-wider uppercase text-[#787B86]">
        <button
          id="result-try-another-look-btn"
          onClick={onTryAnotherLook}
          className="hover:text-[#111216] transition-colors flex items-center gap-1.5"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Try Another Look</span>
        </button>
        <span>·</span>
        <button
          id="result-create-another-btn"
          onClick={onCreateAnother}
          className="hover:text-[#111216] transition-colors flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>New Session</span>
        </button>
      </div>

    </div>
  );
};
