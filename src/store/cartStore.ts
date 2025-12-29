import { create } from 'zustand';
import { VehicleModel, CartItem } from '@/data/models';

interface CartStore {
  items: CartItem[];
  isOpen: boolean;
  addItem: (model: VehicleModel) => void;
  removeItem: (modelId: string) => void;
  updateQuantity: (modelId: string, quantity: number) => void;
  clearCart: () => void;
  toggleCart: () => void;
  closeCart: () => void;
  getTotalPrice: () => number;
  getTotalItems: () => number;
}

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  isOpen: false,

  addItem: (model) => {
    set((state) => {
      const existingItem = state.items.find((item) => item.model.id === model.id);
      if (existingItem) {
        return {
          items: state.items.map((item) =>
            item.model.id === model.id
              ? { ...item, quantity: item.quantity + 1 }
              : item
          ),
        };
      }
      return { items: [...state.items, { model, quantity: 1 }] };
    });
  },

  removeItem: (modelId) => {
    set((state) => ({
      items: state.items.filter((item) => item.model.id !== modelId),
    }));
  },

  updateQuantity: (modelId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(modelId);
      return;
    }
    set((state) => ({
      items: state.items.map((item) =>
        item.model.id === modelId ? { ...item, quantity } : item
      ),
    }));
  },

  clearCart: () => set({ items: [] }),

  toggleCart: () => set((state) => ({ isOpen: !state.isOpen })),

  closeCart: () => set({ isOpen: false }),

  getTotalPrice: () => {
    return get().items.reduce(
      (total, item) => total + item.model.price * item.quantity,
      0
    );
  },

  getTotalItems: () => {
    return get().items.reduce((total, item) => total + item.quantity, 0);
  },
}));
