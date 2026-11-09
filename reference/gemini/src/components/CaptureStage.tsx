import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, ArrowLeft, RefreshCw, Check, Sparkles, AlertCircle } from 'lucide-react';
import { UserPhoto, StudioTemplate, AIExperience } from '../types';
import { SAMPLE_PHOTOS } from '../data/samplePhotos';

interface CaptureStageProps {
  mode: 'basic' | 'advanced';
  selectedTemplate?: StudioTemplate;
  selectedExperience?: AIExperience;
  onPhotoCaptured: (photo: UserPhoto) => void;
  onBackToGallery: () => void;
}

export const CaptureStage: React.FC<CaptureStageProps> = ({
  mode,
  selectedTemplate,
  selectedExperience,
  onPhotoCaptured,
  onBackToGallery,
}) => {
  const [activeTab, setActiveTab] = useState<'camera' | 'upload' | 'samples'>('camera');
  const [capturedPhoto, setCapturedPhoto] = useState<UserPhoto | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCountingDown, setIsCountingDown] = useState<boolean>(false);
  const [countdownNum, setCountdownNum] = useState<number>(3);
  const [flashActive, setFlashActive] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Start webcam when tab is 'camera'
  useEffect(() => {
    if (activeTab === 'camera' && !capturedPhoto) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [activeTab, capturedPhoto]);

  const startCamera = async () => {
    setCameraError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access not supported on this browser');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 960 },
          facingMode: 'user',
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setIsCameraActive(true);
    } catch (err: any) {
      console.warn('Webcam initiation note:', err);
      setIsCameraActive(false);
      setCameraError('Camera access unavailable. You can upload a photo or select a studio sample.');
      // Auto-fallback to upload or samples
      setActiveTab('upload');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const triggerShutterFlash = () => {
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 250);
  };

  const handleTakePhoto = () => {
    if (isCountingDown) return;
    setIsCountingDown(true);
    setCountdownNum(3);

    const interval = setInterval(() => {
      setCountdownNum((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          snapPhoto();
          setIsCountingDown(false);
          return 0;
        }
        return prev - 1;
      });
    }, 800);
  };

  const snapPhoto = () => {
    if (!videoRef.current) return;
    triggerShutterFlash();

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 960;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Flip horizontally for natural mirror feel
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    stopCamera();
    setCapturedPhoto({
      dataUrl,
      source: 'webcam',
      timestamp: Date.now(),
    });
  };

  const handleFileUpload = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (JPEG, PNG, WEBP)');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) {
        triggerShutterFlash();
        setCapturedPhoto({
          dataUrl,
          source: 'upload',
          timestamp: Date.now(),
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSelectSample = (sampleUrl: string) => {
    triggerShutterFlash();
    setCapturedPhoto({
      dataUrl: sampleUrl,
      source: 'sample',
      timestamp: Date.now(),
    });
  };

  const handleContinue = () => {
    if (capturedPhoto) {
      onPhotoCaptured(capturedPhoto);
    }
  };

  const handleRetake = () => {
    setCapturedPhoto(null);
    setActiveTab('camera');
  };

  const contextTitle = mode === 'basic' ? selectedTemplate?.title : selectedExperience?.title;

  return (
    <div className="min-h-screen pt-24 pb-28 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto select-none">
      
      {/* SHUTTER FLASH OVERLAY */}
      {flashActive && (
        <div className="fixed inset-0 z-50 bg-white pointer-events-none transition-opacity duration-200" />
      )}

      {/* TOP BAR */}
      <div className="flex items-center justify-between mb-8">
        <button
          id="capture-back-btn"
          onClick={onBackToGallery}
          className="group inline-flex items-center gap-2 text-xs font-semibold text-[#787B86] hover:text-[#111216] uppercase tracking-wider transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-1 transition-transform" />
          <span>Change {mode === 'basic' ? 'Studio' : 'World'}</span>
        </button>

        <div className="flex items-center gap-2 text-xs text-[#252830] font-medium bg-white/70 backdrop-blur-md px-3 py-1.5 rounded-full border border-[#E8E8E5]">
          <span className="text-[#787B86]">Destination:</span>
          <span className="font-semibold text-[#111216]">{contextTitle}</span>
        </div>
      </div>

      <div className="text-center max-w-xl mx-auto mb-8">
        <h2 className="font-editorial text-4xl sm:text-5xl text-[#111216] font-normal tracking-tight">
          {capturedPhoto ? 'Review your portrait.' : 'Enter the studio stage.'}
        </h2>
        <p className="font-sans-clean text-[#6B7280] text-sm mt-2">
          {capturedPhoto
            ? 'Confirm your photograph before entering the transformation process.'
            : 'Capture with live camera or upload your favorite portrait.'}
        </p>
      </div>

      {/* TABS (ONLY IF NO PHOTO CAPTURED YET) */}
      {!capturedPhoto && (
        <div className="flex justify-center mb-6">
          <div className="flex items-center p-1 rounded-full bg-white/80 backdrop-blur-md border border-[#E8E8E5] shadow-xs">
            <button
              id="capture-tab-camera"
              onClick={() => setActiveTab('camera')}
              className={`px-4 py-2 rounded-full text-xs font-semibold tracking-wide transition-all flex items-center gap-2 ${
                activeTab === 'camera'
                  ? 'bg-[#111216] text-white shadow-xs'
                  : 'text-[#4B5563] hover:text-[#111216]'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Take Photo</span>
            </button>
            <button
              id="capture-tab-upload"
              onClick={() => setActiveTab('upload')}
              className={`px-4 py-2 rounded-full text-xs font-semibold tracking-wide transition-all flex items-center gap-2 ${
                activeTab === 'upload'
                  ? 'bg-[#111216] text-white shadow-xs'
                  : 'text-[#4B5563] hover:text-[#111216]'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload File</span>
            </button>
            <button
              id="capture-tab-samples"
              onClick={() => setActiveTab('samples')}
              className={`px-4 py-2 rounded-full text-xs font-semibold tracking-wide transition-all flex items-center gap-2 ${
                activeTab === 'samples'
                  ? 'bg-[#6558FF] text-white shadow-xs'
                  : 'text-[#4B5563] hover:text-[#111216]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Sample Portraits</span>
            </button>
          </div>
        </div>
      )}

      {/* MAIN PHOTOGRAPHY STAGE VIEWPORT */}
      <div className="relative max-w-xl mx-auto rounded-3xl overflow-hidden bg-white/80 backdrop-blur-md border border-[#E8E8E5] shadow-[0_20px_50px_rgba(0,0,0,0.08)]">
        
        {/* VIEWPORT CONTENT */}
        <div className="relative aspect-[3/4] w-full bg-[#171923] flex items-center justify-center overflow-hidden">
          
          {/* CAMERA COUNTDOWN OVERLAY */}
          {isCountingDown && (
            <div className="absolute inset-0 z-30 bg-black/40 backdrop-blur-xs flex items-center justify-center">
              <span className="font-editorial text-9xl text-white font-bold animate-ping">
                {countdownNum}
              </span>
            </div>
          )}

          {/* 1. REVIEW CAPTURED PHOTO */}
          {capturedPhoto ? (
            <div className="relative w-full h-full animate-fade-in">
              <img
                src={capturedPhoto.dataUrl}
                alt="Captured Portrait"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none" />
              <div className="absolute top-4 right-4 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md text-[11px] font-semibold text-white tracking-wider uppercase">
                Portrait Ready
              </div>
            </div>
          ) : activeTab === 'camera' ? (
            /* 2. LIVE WEBCAM STAGE */
            <div className="relative w-full h-full">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform -scale-x-100"
              />

              {/* Studio Reticle Frame */}
              <div className="absolute inset-8 border border-white/25 rounded-2xl pointer-events-none flex flex-col justify-between p-4">
                <div className="flex justify-between items-start text-white/60 text-[10px] uppercase font-mono tracking-widest">
                  <span>REC · 4K STAGE</span>
                  <span>1/125s · ISO 100</span>
                </div>
                <div className="w-12 h-12 border-2 border-[#6558FF]/80 rounded-full self-center animate-pulse" />
                <div className="flex justify-between items-end text-white/60 text-[10px] uppercase font-mono tracking-widest">
                  <span>FACIAL SYMMETRY OK</span>
                  <span>CELESTIAL OPTICS</span>
                </div>
              </div>

              {cameraError && (
                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-6 text-center text-white">
                  <AlertCircle className="w-10 h-10 text-[#F3B587] mb-3" />
                  <p className="text-sm font-medium mb-4">{cameraError}</p>
                  <button
                    onClick={() => setActiveTab('upload')}
                    className="px-4 py-2 rounded-full bg-white text-[#111216] font-semibold text-xs uppercase tracking-wider"
                  >
                    Switch to Upload
                  </button>
                </div>
              )}
            </div>
          ) : activeTab === 'upload' ? (
            /* 3. DROPZONE STAGE */
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files?.[0]) {
                  handleFileUpload(e.dataTransfer.files[0]);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`w-full h-full flex flex-col items-center justify-center p-8 text-center cursor-pointer transition-colors ${
                isDragging ? 'bg-[#6558FF]/15 border-2 border-dashed border-[#6558FF]' : 'bg-[#181A20] hover:bg-[#1E2028]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
              />
              <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center text-white mb-4 shadow-inner">
                <Upload className="w-7 h-7 text-[#9CC8FF]" />
              </div>
              <h3 className="font-editorial text-2xl text-white font-normal mb-1">
                Drop your portrait here
              </h3>
              <p className="text-xs text-white/65 max-w-xs mb-6">
                Supports high-resolution JPEG, PNG, or WEBP up to 25MB.
              </p>
              <span className="px-5 py-2.5 rounded-full bg-white text-[#111216] font-semibold text-xs uppercase tracking-wider shadow-sm hover:scale-105 transition-transform">
                Browse Photo
              </span>
            </div>
          ) : (
            /* 4. SAMPLE PORTRAITS GRID FOR KIOSK QUICK TESTING */
            <div className="w-full h-full p-6 bg-[#181A20] overflow-y-auto">
              <div className="text-center mb-4">
                <span className="text-xs text-white/70 uppercase tracking-widest font-semibold block">
                  Quick Testing Portraits
                </span>
                <span className="text-[11px] text-white/50">
                  Tap any curated sample to test immediately
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {SAMPLE_PHOTOS.map((sample) => (
                  <button
                    key={sample.id}
                    id={`sample-btn-${sample.id}`}
                    onClick={() => handleSelectSample(sample.avatarUrl)}
                    className="group relative aspect-[3/4] rounded-2xl overflow-hidden border border-white/20 hover:border-[#6558FF] focus:outline-none transition-all"
                  >
                    <img
                      src={sample.avatarUrl}
                      alt={sample.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-2.5">
                      <span className="text-xs text-white font-medium group-hover:text-[#9CC8FF]">
                        {sample.name}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* BOTTOM ACTION BAR */}
        <div className="p-5 bg-white flex items-center justify-between border-t border-[#F0F0EE]">
          {capturedPhoto ? (
            <>
              <button
                id="capture-retake-btn"
                onClick={handleRetake}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-[#E8E8E5] text-xs font-semibold text-[#252830] hover:border-[#111216] transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retake / Replace</span>
              </button>

              <button
                id="capture-continue-btn"
                onClick={handleContinue}
                className="inline-flex items-center gap-2 px-7 py-2.5 rounded-full bg-[#111216] text-white text-xs font-semibold uppercase tracking-wider hover:bg-[#6558FF] transition-colors shadow-md"
              >
                <span>Continue to Review</span>
                <Check className="w-4 h-4" />
              </button>
            </>
          ) : activeTab === 'camera' ? (
            <>
              <div className="text-xs text-[#787B86] flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#7FA685]" />
                <span>3s Shutter Timer</span>
              </div>

              <button
                id="capture-shutter-btn"
                onClick={handleTakePhoto}
                disabled={isCountingDown || !isCameraActive}
                className="inline-flex items-center gap-2 px-8 py-3 rounded-full bg-[#6558FF] hover:bg-[#5446E8] text-white font-semibold text-xs uppercase tracking-wider shadow-lg hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
              >
                <Camera className="w-4 h-4" />
                <span>Take Photo</span>
              </button>
            </>
          ) : (
            <div className="w-full text-center text-xs text-[#787B86]">
              Studio photography tips: Center face · Natural lighting · Neutral expression
            </div>
          )}
        </div>

      </div>

    </div>
  );
};
