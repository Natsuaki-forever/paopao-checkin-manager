import pigTank from "../assets/pig-tank-easter-egg.png";

export function PigTankEasterEgg({ variant }: { variant: "wiggle" | "drive" | "peek" }) {
  return <span className={`pig-easter-egg pig-${variant}`} aria-hidden="true"><img src={pigTank} alt="" /></span>;
}
