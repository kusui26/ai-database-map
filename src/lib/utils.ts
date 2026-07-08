import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind クラスの結合（条件付き＋競合解決）。shadcn/ui の慣用ユーティリティ。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
