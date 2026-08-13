import {
  Apple,
  Bean,
  Beef,
  Bird,
  Boxes,
  Building2,
  Carrot,
  Cherry,
  Citrus,
  Drumstick,
  Egg,
  EggFried,
  Fish,
  Grape,
  Ham,
  Leaf,
  Milk,
  Package,
  Rabbit,
  Salad,
  Shell,
  Sprout,
  Waves,
  Wheat,
  type LucideIcon,
} from 'lucide-react'

// Curated catalog: kebab-case name → Lucide component. Extend here to expose new choices.
const CATALOG: Record<string, LucideIcon> = {
  wheat: Wheat,
  sprout: Sprout,
  leaf: Leaf,
  carrot: Carrot,
  apple: Apple,
  cherry: Cherry,
  grape: Grape,
  citrus: Citrus,
  salad: Salad,
  bean: Bean,
  fish: Fish,
  shell: Shell,
  waves: Waves,
  bird: Bird,
  drumstick: Drumstick,
  beef: Beef,
  rabbit: Rabbit,
  egg: Egg,
  'egg-fried': EggFried,
  milk: Milk,
  ham: Ham,
  package: Package,
  boxes: Boxes,
  'building-2': Building2,
}

export function CommodityIcon({ name, code, size = 18 }: { name?: string; code?: string; size?: number }) {
  const Icon = name ? CATALOG[name] : undefined
  if (Icon) return <span className="commodity-symbol" aria-hidden="true"><Icon size={size} strokeWidth={1.75} /></span>
  return <span className="commodity-symbol" aria-hidden="true">{code?.slice(0, 2) ?? '·'}</span>
}
