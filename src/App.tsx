import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import Header from "./components/Header";
import Footer from "./components/Footer";
import CartDrawer from "./components/CartDrawer";
import RouteSeoManager from "./components/RouteSeoManager";
import AttributionTracker from "./components/AttributionTracker";
import ScrollToTop from "./components/ScrollToTop";
import HomePage from "./pages/HomePage";
import CatalogPage from "./pages/CatalogPage";
import OptionsPage from "./pages/OptionsPage";
import ModelDetailPage from "./pages/ModelDetailPage";
import CompanyPage from "./pages/CompanyPage";
import DealersPage from "./pages/DealersPage";
import TyumenDealersPage from "./pages/TyumenDealersPage";
import ContactsPage from "./pages/ContactsPage";
import DeliveryPage from "./pages/DeliveryPage";
import FinanceCalculatorPage from "./pages/FinanceCalculatorPage";
import MediaPage from "./pages/MediaPage";
import OrderPage from "./pages/OrderPage";
import ArticlesPage from "./pages/ArticlesPage";
import ArticleDetailPage from "./pages/ArticleDetailPage";
import ApplicationsPage from "./pages/ApplicationsPage";
import ApplicationDetailPage from "./pages/ApplicationDetailPage";
import PrivacyPage from "./pages/PrivacyPage";
import CookieConsent from "./components/CookieConsent";
import NewYearPromo from "./components/NewYearPromo";
import YandexMetrika from "./components/YandexMetrika";
import VkPixel from "./components/VkPixel";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <YandexMetrika />
        <VkPixel />
        <AttributionTracker />
        <RouteSeoManager />
        <ScrollToTop />
        <Header />
        <CartDrawer />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/options" element={<OptionsPage />} />
          <Route path="/catalog/rosomaha-base" element={<Navigate to="/catalog" replace />} />
          <Route path="/catalog/:slug" element={<ModelDetailPage />} />
          <Route path="/company" element={<CompanyPage />} />
          <Route path="/dealers" element={<DealersPage />} />
          <Route path="/dealers/tyumen" element={<TyumenDealersPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/delivery" element={<DeliveryPage />} />
          <Route path="/finansirovanie" element={<FinanceCalculatorPage />} />
          <Route path="/media" element={<MediaPage />} />
          <Route path="/order" element={<OrderPage />} />
          <Route path="/articles" element={<ArticlesPage />} />
          <Route path="/instagram" element={<Navigate to="/articles" replace />} />
          <Route path="/articles/:slug" element={<ArticleDetailPage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/applications/:slug" element={<ApplicationDetailPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/politika-konfidencialnosti" element={<PrivacyPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <Footer />
        <CookieConsent />
        <NewYearPromo />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
