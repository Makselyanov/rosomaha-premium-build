import { create } from 'zustand';
import { Product, ProductVariant, ProductColor, ProductOption } from '@/data/products';

export interface CartItemConfig {
  product: Product;
  variant: ProductVariant;
  color: ProductColor;
  options: ProductOption[];
  quantity: number;
}

interface CartStore {
  items: CartItemConfig[];
  isOpen: boolean;
  addItem: (config: Omit<CartItemConfig, 'quantity'>) => void;
  removeItem: (index: number) => void;
  updateQuantity: (index: number, quantity: number) => void;
  removeOption: (itemIndex: number, optionId: string) => void;
  clearCart: () => void;
  toggleCart: () => void;
  closeCart: () => void;
  getTotalPrice: () => number;
  getTotalItems: () => number;
  getItemTotal: (item: CartItemConfig) => number;
}

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  isOpen: false,

  addItem: (config) => {
    set((state) => ({
      items: [...state.items, { ...config, quantity: 1 }],
    }));
  },

  removeItem: (index) => {
    set((state) => ({
      items: state.items.filter((_, i) => i !== index),
    }));
  },

  updateQuantity: (index, quantity) => {
    if (quantity <= 0) {
      get().removeItem(index);
      return;
    }
    set((state) => ({
      items: state.items.map((item, i) =>
        i === index ? { ...item, quantity } : item
      ),
    }));
  },

  removeOption: (itemIndex, optionId) => {
    set((state) => ({
      items: state.items.map((item, i) =>
        i === itemIndex
          ? { ...item, options: item.options.filter((o) => o.id !== optionId) }
          : item
      ),
    }));
  },

  clearCart: () => set({ items: [] }),

  toggleCart: () => set((state) => ({ isOpen: !state.isOpen })),

  closeCart: () => set({ isOpen: false }),

  getItemTotal: (item) => {
    const optionsTotal = item.options.reduce((sum, o) => sum + o.price, 0);
    return (item.variant.price + optionsTotal) * item.quantity;
  },

  getTotalPrice: () => {
    const { items, getItemTotal } = get();
    return items.reduce((total, item) => total + getItemTotal(item), 0);
  },

  getTotalItems: () => {
    return get().items.reduce((total, item) => total + item.quantity, 0);
  },
}));
