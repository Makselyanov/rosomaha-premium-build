import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight, Briefcase, Palmtree, ChevronRight, Home } from 'lucide-react';
import { useState, useEffect } from 'react';
import { applications, applicationCategories } from '@/data/applications';

export default function ApplicationsPage() {
    const [activeTab, setActiveTab] = useState<'all' | 'professional' | 'leisure'>('all');

    // Scroll to top on mount
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    const filteredApplications = activeTab === 'all'
        ? applications
        : applications.filter(app => app.category === activeTab);

    return (
        <main className="min-h-screen bg-background pt-24 pb-16">
            <div className="container">
                {/* Breadcrumbs */}
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-8">
                    <Link to="/" className="hover:text-primary transition-colors">
                        <Home className="w-4 h-4" />
                    </Link>
                    <ChevronRight className="w-4 h-4" />
                    <span className="text-foreground">Сферы применения</span>
                </div>

                {/* Header */}
                <div className="text-center mb-16 max-w-4xl mx-auto">
                    <motion.h1
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-6"
                    >
                        Для любых <span className="text-gradient">задач</span> и маршрутов
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="text-xl text-muted-foreground"
                    >
                        Выбирайте сферу применения, чтобы узнать, как Росомаха решит ваши задачи там, где нет дорог.
                    </motion.p>
                </div>

                {/* Filters */}
                <div className="flex justify-center flex-wrap gap-4 mb-16">
                    <button
                        onClick={() => setActiveTab('all')}
                        className={`px-6 py-3 rounded-xl font-medium transition-all duration-300 ${activeTab === 'all'
                                ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                                : 'bg-secondary/50 hover:bg-secondary hover:text-foreground text-muted-foreground'
                            }`}
                    >
                        Все сферы
                    </button>
                    <button
                        onClick={() => setActiveTab('professional')}
                        className={`px-6 py-3 rounded-xl font-medium transition-all duration-300 flex items-center gap-2 ${activeTab === 'professional'
                                ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                                : 'bg-secondary/50 hover:bg-secondary hover:text-foreground text-muted-foreground'
                            }`}
                    >
                        <Briefcase className="w-4 h-4" />
                        {applicationCategories.professional}
                    </button>
                    <button
                        onClick={() => setActiveTab('leisure')}
                        className={`px-6 py-3 rounded-xl font-medium transition-all duration-300 flex items-center gap-2 ${activeTab === 'leisure'
                                ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                                : 'bg-secondary/50 hover:bg-secondary hover:text-foreground text-muted-foreground'
                            }`}
                    >
                        <Palmtree className="w-4 h-4" />
                        {applicationCategories.leisure}
                    </button>
                </div>

                {/* Grid */}
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredApplications.map((app, index) => (
                        <motion.div
                            layout
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.3, delay: index * 0.05 }}
                            key={app.id}
                            className="group bg-card border border-border hover:border-primary/50 rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col"
                        >
                            <Link to={`/applications/${app.slug}`} className="block relative aspect-[16/10] overflow-hidden">
                                <img
                                    src={app.image || '/media/placeholder-application.jpg'}
                                    alt={app.title}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />

                                <div className="absolute top-4 left-4">
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${app.category === 'professional'
                                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                            : 'bg-green-500/20 text-green-400 border border-green-500/30'
                                        }`}>
                                        {app.category === 'professional' ? 'Работа' : 'Отдых'}
                                    </span>
                                </div>
                            </Link>

                            <div className="p-6 flex flex-col flex-grow">
                                <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">
                                    <Link to={`/applications/${app.slug}`}>
                                        {app.title}
                                    </Link>
                                </h3>
                                <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                                    {app.tagline}
                                </p>

                                <div className="mt-auto pt-4 border-t border-border/50">
                                    <div className="flex items-start gap-2 mb-4">
                                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                                        <p className="text-xs text-muted-foreground line-clamp-2">
                                            <span className="text-foreground font-medium">Проблема:</span> {app.pain}
                                        </p>
                                    </div>
                                    <div className="flex items-start gap-2 mb-6">
                                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 flex-shrink-0" />
                                        <p className="text-xs text-muted-foreground line-clamp-2">
                                            <span className="text-foreground font-medium">Решение:</span> {app.solution}
                                        </p>
                                    </div>

                                    <Link
                                        to={`/applications/${app.slug}`}
                                        className="w-full inline-flex items-center justify-center px-4 py-3 bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground rounded-xl font-medium transition-all duration-300 group-hover:shadow-lg group-hover:shadow-primary/25"
                                    >
                                        Подробнее
                                        <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
                                    </Link>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>

                {/* Empty State */}
                {filteredApplications.length === 0 && (
                    <div className="text-center py-24">
                        <p className="text-muted-foreground text-lg">В данной категории пока нет статей.</p>
                        <button onClick={() => setActiveTab('all')} className="mt-4 text-primary hover:underline">
                            Показать все сферы
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}
