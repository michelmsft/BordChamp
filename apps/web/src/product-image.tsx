import { CommodityIcon } from './icons'
import { productImageSource } from './product-images'

export function ProductImage({ name, alt, className }: { name: string; alt: string; className?: string }) {
  return <img className={className} src={productImageSource(name)} alt={alt} loading="lazy" />
}

export function CommodityVisual({ imageName, iconName, code, alt = '' }: { imageName?: string; iconName?: string; code: string; alt?: string }) {
  return imageName
    ? <ProductImage name={imageName} alt={alt} className="commodity-thumbnail" />
    : <CommodityIcon name={iconName} code={code} />
}