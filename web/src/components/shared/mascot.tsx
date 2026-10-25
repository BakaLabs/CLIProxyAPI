import { cn } from "@/lib/utils";

export type MascotMood =
  | "happy"
  | "waving"
  | "curious"
  | "sleeping"
  | "love"
  | "shocked"
  | "sparkle"
  | "tears";

interface MascotProps {
  className?: string;
  size?: number;
  mood?: MascotMood;
}

/**
 * Adorable cat mascot SVG inspired by the design mockup.
 * Clean, lightweight, scalable vector asset with expressive anime eyes,
 * blue tipped ears, soft cheeks, and signature bell collar.
 */
export function Mascot({ className, size = 48, mood = "happy" }: MascotProps) {
  return (
    <div
      style={{ width: size, height: size }}
      className={cn("relative inline-flex shrink-0 items-center justify-center select-none", className)}
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="size-full drop-shadow-sm transition-transform duration-300 hover:scale-105"
      >
        <defs>
          <linearGradient id="cat-body-grad" x1="50" y1="20" x2="50" y2="90" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFFFF" />
            <stop offset="1" stopColor="#F1F5F9" />
          </linearGradient>
          <linearGradient id="cat-ear-grad" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#93C5FD" />
            <stop offset="1" stopColor="#3B82F6" />
          </linearGradient>
          <linearGradient id="cat-collar-grad" x1="0" y1="0" x2="1" y2="0">
            <stop stopColor="#3B82F6" />
            <stop offset="1" stopColor="#60A5FA" />
          </linearGradient>
        </defs>

        {/* Left Ear */}
        <path d="M 24 44 L 14 18 C 13 15 17 13 20 16 L 36 34 Z" fill="#3B82F6" />
        <path d="M 23 41 L 16 20 C 15 18 18 17 20 19 L 33 34 Z" fill="url(#cat-ear-grad)" opacity="0.9" />

        {/* Right Ear */}
        <path d="M 76 44 L 86 18 C 87 15 83 13 80 16 L 64 34 Z" fill="#3B82F6" />
        <path d="M 77 41 L 84 20 C 85 18 82 17 80 19 L 67 34 Z" fill="url(#cat-ear-grad)" opacity="0.9" />

        {/* Head */}
        <ellipse cx="50" cy="52" rx="36" ry="32" fill="url(#cat-body-grad)" stroke="#E2E8F0" strokeWidth="2" />

        {/* Cheek blushes */}
        <ellipse cx="26" cy="59" rx="6" ry="3.5" fill="#FDA4AF" opacity={mood === "love" ? 0.9 : 0.6} />
        <ellipse cx="74" cy="59" rx="6" ry="3.5" fill="#FDA4AF" opacity={mood === "love" ? 0.9 : 0.6} />

        {/* Blue forehead tuft */}
        <path d="M 44 26 C 47 22 53 22 56 26 C 54 30 46 30 44 26 Z" fill="#60A5FA" opacity="0.8" />

        {/* Eyes according to mood */}
        {mood === "sleeping" ? (
          <>
            <path d="M 31 50 Q 36 55 41 50" stroke="#1E293B" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M 59 50 Q 64 55 69 50" stroke="#1E293B" strokeWidth="2.5" strokeLinecap="round" />
          </>
        ) : mood === "curious" ? (
          <>
            <circle cx="36" cy="49" r="4.5" fill="#1E293B" />
            <circle cx="34.5" cy="47.5" r="1.5" fill="#FFFFFF" />
            <path d="M 59 50 Q 64 45 69 50" stroke="#1E293B" strokeWidth="2.5" strokeLinecap="round" />
          </>
        ) : mood === "love" ? (
          <>
            <path d="M 33 48 C 33 44 38 44 38 48 C 38 52 33 55 33 55 C 33 55 28 52 28 48 C 28 44 33 44 33 48 Z" fill="#F43F5E" />
            <path d="M 67 48 C 67 44 72 44 72 48 C 72 52 67 55 67 55 C 67 55 62 52 62 48 C 62 44 67 44 67 48 Z" fill="#F43F5E" />
          </>
        ) : mood === "shocked" ? (
          <>
            <circle cx="36" cy="49" r="5.5" stroke="#1E293B" strokeWidth="2" fill="#FFFFFF" />
            <circle cx="36" cy="49" r="2" fill="#1E293B" />
            <circle cx="64" cy="49" r="5.5" stroke="#1E293B" strokeWidth="2" fill="#FFFFFF" />
            <circle cx="64" cy="49" r="2" fill="#1E293B" />
          </>
        ) : mood === "sparkle" ? (
          <>
            <circle cx="36" cy="49" r="4.5" fill="#1E293B" />
            <circle cx="34.5" cy="47" r="1.8" fill="#FFFFFF" />
            <polygon points="64,43 65.5,47 69.5,48.5 65.5,50 64,54 62.5,50 58.5,48.5 62.5,47" fill="#FBBF24" />
          </>
        ) : mood === "tears" ? (
          <>
            <path d="M 31 52 Q 36 47 41 52" stroke="#1E293B" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M 59 52 Q 64 47 69 52" stroke="#1E293B" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M 28 56 Q 26 62 28 66 Q 31 64 30 58 Z" fill="#38BDF8" />
            <path d="M 72 56 Q 74 62 72 66 Q 69 64 70 58 Z" fill="#38BDF8" />
          </>
        ) : (
          <>
            {/* Standard happy eyes */}
            <circle cx="36" cy="49" r="4.5" fill="#1E293B" />
            <circle cx="34.5" cy="47" r="1.8" fill="#FFFFFF" />
            <circle cx="37.5" cy="50.5" r="0.8" fill="#60A5FA" />

            <circle cx="64" cy="49" r="4.5" fill="#1E293B" />
            <circle cx="62.5" cy="47" r="1.8" fill="#FFFFFF" />
            <circle cx="65.5" cy="50.5" r="0.8" fill="#60A5FA" />
          </>
        )}

        {/* Nose */}
        <path d="M 48 56 Q 50 55 52 56 Q 50 58.5 48 56 Z" fill="#FB7185" />

        {/* Mouth */}
        {mood === "shocked" ? (
          <ellipse cx="50" cy="62" rx="3.5" ry="5" fill="#1E293B" />
        ) : mood === "tears" ? (
          <path d="M 46 63 Q 50 59 54 63" stroke="#1E293B" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        ) : (
          <path
            d="M 45 59 Q 50 63 50 59 Q 50 63 55 59"
            stroke="#1E293B"
            strokeWidth="1.8"
            strokeLinecap="round"
            fill="none"
          />
        )}

        {/* Whiskers */}
        <path d="M 17 53 Q 23 55 27 55" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M 16 60 Q 23 59 28 58" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M 83 53 Q 77 55 73 55" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M 84 60 Q 77 59 72 58" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" />

        {/* Collar & Bell */}
        <path d="M 32 78 Q 50 86 68 78 Q 50 82 32 78 Z" fill="url(#cat-collar-grad)" />
        <circle cx="50" cy="82" r="3.5" fill="#FBBF24" stroke="#D97706" strokeWidth="1" />

        {/* Waving paw */}
        {(mood === "waving" || mood === "sparkle") && (
          <ellipse cx="80" cy="72" rx="6" ry="8" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="1.5" transform="rotate(-25 80 72)" />
        )}
      </svg>
    </div>
  );
}

/**
 * Mascot Avatar component with circular border and status badge
 */
export function MascotAvatar({
  size = 40,
  mood = "happy",
  online = true,
  className,
}: {
  size?: number;
  mood?: MascotMood;
  online?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative inline-flex shrink-0 items-center justify-center", className)}>
      <div
        style={{ width: size, height: size }}
        className="relative overflow-hidden rounded-full border-2 border-white/90 bg-gradient-to-b from-blue-50/80 to-blue-100/60 p-0.5 shadow-sm ring-1 ring-blue-200/50 dark:border-slate-800 dark:from-slate-800 dark:to-slate-900 dark:ring-blue-900/40"
      >
        <Mascot size={size - 4} mood={mood} />
      </div>
      {online !== undefined && (
        <span
          className={cn(
            "absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white dark:border-slate-900",
            online ? "bg-emerald-500" : "bg-slate-400",
          )}
        />
      )}
    </div>
  );
}


