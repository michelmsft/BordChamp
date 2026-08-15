import { CommodityIcon } from './icons'
import { productImageSource } from './product-images'

const DEFAULT_PRODUCT_IMAGES: Readonly<Record<string, string>> = {
  MAIZE: 'crop-05',
  CORN: 'crop-05',
  RIZ: 'crop-03',
  RICE: 'crop-03',
  SORGHUM: 'crop-06',
  SORGHUM_GRAIN: 'crop-06',
}

export function ProductImage({ name, alt, className }: { name: string; alt: string; className?: string }) {
  return <img className={className} src={productImageSource(name)} alt={alt} loading="lazy" />
}

export function CommodityVisual({ imageName, iconName, code, alt = '' }: { imageName?: string; iconName?: string; code: string; alt?: string }) {
  const resolvedImage = imageName || DEFAULT_PRODUCT_IMAGES[code.toUpperCase()]
  return resolvedImage
    ? <ProductImage name={resolvedImage} alt={alt} className="commodity-thumbnail" />
    : <CommodityIcon name={iconName} code={code} />
}