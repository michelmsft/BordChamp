import { PRODUCT_IMAGE_CATALOG } from './product-image-catalog'

export const PRODUCT_IMAGE_GROUPS = PRODUCT_IMAGE_CATALOG
export type ProductImageGroupId = (typeof PRODUCT_IMAGE_GROUPS)[number]['id']

export function productImageSource(name: string): string {
  return `/commodities/${name}.png`
}