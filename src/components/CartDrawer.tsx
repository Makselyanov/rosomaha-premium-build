import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Minus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCartStore } from '@/store/cartStore';

export default function CartDrawer() {
  const { items, isOpen, closeCart, updateQuantity, removeItem, removeOption, getTotalPrice, getItemTotal } = useCartStore();

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('ru-RU').format(price) + ' ₽';
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeCart}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-card border-l border-border z-50 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h2 className="text-xl font-display uppercase tracking-wider">Корзина</h2>
              <button
                onClick={closeCart}
                className="p-2 hover:bg-secondary rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {items.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground mb-4">Корзина пуста</p>
                  <Link
                    to="/catalog"
                    onClick={closeCart}
                    className="text-primary hover:underline"
                  >
                    Перейти в каталог
                  </Link>
                </div>
              ) : (
                <div className="space-y-6">
                  {items.map((item, index) => (
                    <div
                      key={`${item.product.id}-${index}`}
                      className="p-4 bg-secondary/50 rounded-lg space-y-3"
                    >
                      <div className="flex gap-4">
                        <img
                          src={item.product.gallery[0]}
                          alt={item.product.name}
                          className="w-20 h-20 object-cover rounded-lg"
                        />
                        <div className="flex-1 min-w-0">
                          <h3 className="font-display text-sm uppercase tracking-wider mb-1 truncate">
                            {item.product.name}
                          </h3>
                          <p className="text-xs text-muted-foreground mb-1">
                            {item.variant.name}
                          </p>
                          <div className="flex items-center gap-2 text-xs">
                            <span
                              className="w-4 h-4 rounded-full border border-border"
                              style={{ backgroundColor: item.color.hex }}
                            />
                            <span className="text-muted-foreground">{item.color.name}</span>
                          </div>
                        </div>
                      </div>

                      {/* Options */}
                      {item.options.length > 0 && (
                        <div className="text-xs space-y-1 pl-2 border-l-2 border-primary/30">
                          {item.options.map((option) => (
                            <div key={option.id} className="flex items-center justify-between">
                              <span className="text-muted-foreground truncate flex-1">
                                {option.name}
                              </span>
                              <span className="text-primary ml-2">+{option.priceFormatted}</span>
                              <button
                                onClick={() => removeOption(index, option.id)}
                                className="ml-2 p-0.5 text-destructive hover:bg-destructive/10 rounded"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Price & Controls */}
                      <div className="flex items-center justify-between pt-2 border-t border-border">
                        <p className="text-primary font-semibold">
                          {formatPrice(getItemTotal(item))}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateQuantity(index, item.quantity - 1)}
                            className="p-1 hover:bg-border rounded transition-colors"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className="w-8 text-center">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(index, item.quantity + 1)}
                            className="p-1 hover:bg-border rounded transition-colors"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => removeItem(index)}
                            className="ml-2 p-1 text-destructive hover:bg-destructive/10 rounded transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {items.length > 0 && (
              <div className="p-6 border-t border-border space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Итого:</span>
                  <span className="text-2xl font-display font-bold text-gradient">
                    {formatPrice(getTotalPrice())}
                  </span>
                </div>
                <Link
                  to="/order"
                  onClick={closeCart}
                  className="btn-primary w-full text-center"
                >
                  Оформить заявку
                </Link>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
