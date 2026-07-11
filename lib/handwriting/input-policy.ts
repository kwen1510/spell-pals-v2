export interface PointerContact {
  pointerType: string;
  width: number;
  height: number;
}

export function shouldIgnoreTouchInput(
  contact: PointerContact,
  options: { stylusOnly: boolean; millisecondsSincePen: number; palmSize?: number },
) {
  if (contact.pointerType !== "touch") return false;
  return options.stylusOnly
    || options.millisecondsSincePen < 1200
    || Math.max(contact.width, contact.height) >= (options.palmSize ?? 32);
}
