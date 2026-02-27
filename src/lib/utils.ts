import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { DisplayLang, Taxonomy } from "@/store/catalogStore"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getBirdName(
  sciName: string | undefined,
  fallbackZh: string | undefined,
  taxonomy: Taxonomy,
  lang: DisplayLang,
): string {
  if (!sciName) return fallbackZh || '未知'
  
  if (lang === 'sci') return sciName

  const item = taxonomy[sciName]
  if (!item) return fallbackZh || sciName

  if (lang === 'zh_CN') return item.zh_CN || item.zh_TW || item.en || sciName
  if (lang === 'zh_TW') return item.zh_TW || item.zh_CN || item.en || sciName
  if (lang === 'en') return item.en || sciName

  return sciName
}
