import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight, Play, Briefcase, Palmtree } from 'lucide-react';
import { useState } from 'react';
import { applications } from '@/data/applications';

export default function ApplicationsSection() {
    const [activeTab, setActiveTab] = useState<'professional' | 'leisure'>('professional');

    const filteredApplications = applications.filter(app => app.category === activeTab);
    const displayedApplications = filteredApplications.slice(0, 6);

    return (
        <section className="py-24 bg-secondary/30">
            <div className="container">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-center mb-12">
                    <h2 className="section-title mb-4">
                        Применение <span className="text-gradient">техники</span>
                    </h2>
                    <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                        Доехать туда, где нет дорог. Довезти то, что нужно. Вернуться целым и вовремя.
                    </p>
                </motion.div>

                {/* Tabs */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.1 }}
                    className="flex justify-center gap-4 mb-12">
                    <button
                        onClick={() => setActiveTab('professional')}
                        className={`px-8 py-4 rounded-xl font-semibold text-lg transition-all duration-300 flex items-center gap-3 ${activeTab === 'professional'
                                ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/50'
                                : 'bg-card border border-border hover:border-primary/50'
                            }`}>
                        <Briefcase className="w-5 h-5" />
                        Профзадачи
                    </button>
                    <button
                        onClick={() => setActiveTab('leisure')}
                        className={`px-8 py-4 rounded-xl font-semibold text-lg transition-all duration-300 flex items-center gap-3 ${activeTab === 'leisure'
                                ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/50'
                                : 'bg-card border border-border hover:border-primary/50'
                            }`}>
                        <Palmtree className="w-5 h-5" />
                        Отдых
                    </button>
                </motion.div>

                {/* Cards Grid */}
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
                    {displayedApplications.map((app, index) => (
                        <motion.div
                            key={app.id}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: index * 0.1 }}
                            className="group bg-card border border-border hover:border-primary/50 rounded-2xl overflow-hidden transition-all duration-300">
                            {/* Image Preview */}
                            <div className="relative aspect-[16/10] overflow-hidden bg-secondary">
                                <img
                                    src={app.image || '/media/placeholder-application.jpg'}
                                    alt={app.title}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
                                {app.video && (
                                    <div className="absolute top-4 right-4 w-12 h-12 bg-primary/90 backdrop-blur-sm rounded-full flex items-center justify-center">
                                        <Play className="w-5 h-5 text-primary-foreground ml-0.5" />
                                    </div>
                                )}
                                <div className="absolute bottom-4 left-4 right-4">
                                    <h3 className="font-semibold text-lg text-white drop-shadow-lg">
                                        {app.title}
                                    </h3>
                                    <p className="text-xs text-white/80 mt-1">{app.tagline}</p>
                                </div>
                            </div>

                            {/* Content */}
                            <div className="p-6">
                                {/* Pain Point */}
                                <div className="mb-4">
                                    <p className="text-sm text-muted-foreground mb-2">
                                        {app.pain}
                                    </p>
                                    <p className="text-sm font-medium text-primary">
                                        ✓ {app.solution}
                                    </p>
                                </div>

                                {/* CTAs */}
                                <div className="space-y-2">
                                    <Link
                                        to={`/applications/${app.slug}`}
                                        className="w-full inline-flex items-center justify-center px-4 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors">
                                        Подобрать комплектацию
                                        <ArrowRight className="w-4 h-4 ml-2" />
                                    </Link>
                                    <Link
                                        to={`/applications/${app.slug}#cases`}
                                        className="w-full inline-flex items-center justify-center px-4 py-2.5 border border-border hover:border-primary/50 rounded-lg font-medium transition-colors">
                                        Смотреть кейсы
                                    </Link>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>

                {/* View All Link */}
                <motion.div
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true }}
                    className="text-center">
                    <Link
                        to="/applications"
                        className="inline-flex items-center gap-3 px-8 py-4 bg-card border-2 border-primary hover:bg-primary hover:text-primary-foreground rounded-xl font-semibold text-lg transition-all duration-300 shadow-lg">
                        Смотреть все сферы применения
                        <ArrowRight className="w-5 h-5" />
                    </Link>
                </motion.div>
            </div>
        </section>
    );
}
