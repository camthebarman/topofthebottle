import { UNITS } from "@tz/domain";
import type { UnitOpt } from "./forms";

export const unitOptions: UnitOpt[] = Object.values(UNITS).map((u) => ({ id: u.id, label: u.label, dimension: u.dimension }));
