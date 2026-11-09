import { Button } from "@csq/ui/components/ui/button";
import { Dialog } from "@csq/ui/components/ui/dialog";
import { Input } from "@csq/ui/components/ui/input";
import { Textarea } from "@csq/ui/components/ui/textarea";

export function AgentDialog(props: {
  open: boolean;
  mode: "create" | "edit";
  name: string;
  instructions: string;
  saving: boolean;
  onNameChange: (v: string) => void;
  onInstructionsChange: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const isCreate = props.mode === "create";
  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title={isCreate ? "Buat Agent" : "Edit Agent"}
      description={
        isCreate
          ? "Agent baru dibuat sebagai draf. Deploy untuk mengaktifkannya."
          : "Ubah nama dan instruksi (persona) agent."
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Nama</span>
          <Input
            value={props.name}
            onChange={(e) => props.onNameChange(e.target.value)}
            placeholder={isCreate ? "Contoh: Customer Service" : "Nama agent"}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Instruksi (persona)
          </span>
          <Textarea
            value={props.instructions}
            onChange={(e) => props.onInstructionsChange(e.target.value)}
            placeholder="Kamu adalah customer service..."
            rows={6}
          />
          <span className="mt-1 block text-xs text-slate-400">
            {isCreate
              ? "Tipe agent: Customer Service. Tipe khusus lain (Sales, Inventaris) dapat ditambahkan kemudian."
              : "Instruksi ini menjadi system prompt agent pada setiap percakapan."}
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={props.onClose} disabled={props.saving}>
            Batal
          </Button>
          <Button
            onClick={props.onSave}
            disabled={props.saving || (isCreate && !props.name.trim())}
          >
            {props.saving
              ? isCreate
                ? "Membuat..."
                : "Menyimpan..."
              : isCreate
                ? "Buat"
                : "Simpan"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
