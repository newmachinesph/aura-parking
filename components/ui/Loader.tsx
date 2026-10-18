import { Loader2 } from "lucide-react";

export default function Loader() {
  return (
    <div className="flex items-center justify-center min-h-[50dvh]">
      <Loader2 size={32} className="animate-spin text-primary-500" />
    </div>
  );
}
