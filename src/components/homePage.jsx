import React from "react";
import "./homePage.css";

function HomePage() {
    return (
        <main>
            <section className="top-section">
                <div className="logo-component">
                    <img className="insight-logo" src="/insight-logo.png" alt="logo" />
                </div>
                <div className="banner">
                    <div className="prefix-star">
                        <svg 
                            xmlns="http://www.w3.org/2000/svg" 
                            width="24" 
                            height="24" 
                            viewBox="0 0 24 24" 
                            fill="#ffffff" 
                            stroke="currentColor" 
                            stroke-width="2" 
                            stroke-linecap="round" 
                            stroke-linejoin="round" 
                            class="lucide lucide-star preview-icon">
                                <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>
                        </svg>
                    </div>
                    <p className="banner-text">
                        BEST DIGITAL NEWS PLATFORM IN 2026
                    </p>
                    <div className="suffix-star">
                        <svg 
                            xmlns="http://www.w3.org/2000/svg" 
                            width="24" 
                            height="24" 
                            viewBox="0 0 24 24" 
                            fill="#ffffff" 
                            stroke="currentColor" 
                            stroke-width="2" 
                            stroke-linecap="round" 
                            stroke-linejoin="round" 
                            class="lucide lucide-star preview-icon">
                                <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>
                        </svg>
                    </div>
                </div>
                <div className="search-icon">
                    <svg 
                        xmlns="http://www.w3.org/2000/svg" 
                        width="24" 
                        height="24" 
                        viewBox="0 0 24 24" 
                        fill="none" 
                        stroke="currentColor" 
                        stroke-width="2" 
                        stroke-linecap="round" 
                        stroke-linejoin="round" 
                        class="lucide lucide-search preview-icon">
                            <path d="m21 21-4.34-4.34"/>
                            <circle cx="11" cy="11" r="8"/>
                        </svg>
                </div>
            </section>
            <section className="nav-bar">
                <div className="nav-group">
                    <p className="home-tab">Home</p>
                </div>
                <div className="nav-group">
                    <p className="news-tab">News</p>
                </div>
                <div className="nav-group">
                    <p className="politics-tab">Politics</p>
                </div>
                <div className="nav-group">
                    <p className="world-tab">World</p>
                </div>
                <div className="nav-group">
                    <p className="business-tab">Business</p>
                </div>
                <div className="nav-group">
                    <p className="entertainment-tab">Entertainment</p>
                </div>
                <div className="nav-group">
                    <p className="sports-tab">Sports</p>
                </div>
                <div className="nav-group">
                    <p className="lifestyle-tab">Lifestyle</p>
                </div>
                <div className="nav-group">
                    <p className="opinion-tab">Opinion</p>
                </div>
            </section>
            <section className="breaker-section">
                <div className="breaker-component">
                    <h2>KENYA BREAKING NEWS</h2>
                </div>
            </section>
            <section className="breaking-news-section">
                <div className="breaking-news">
                    <div className="news-image">
                        <img className="article-image" src="/talanta-image.jpeg" alt="breaking-news-image" />
                    </div>
                    <div className="news-content">
                        <div className="tag">
                            <p className="breaking-tag">BREAKING</p>
                        </div>
                        <div className="title">
                            <h3 className="breaking-title">
                                The Awaited Game: Bayern Munich, Ajax to Play at Talant Stadium Opening, 
                                Ruto Announces
                            </h3>
                        </div>
                        <div className="description">
                            <p className="description-text">
                                On the day his cabinet was staring at dissolution, President Ruto announced 
                                the date of Talant Stadium opening with a match being played by European ...
                            </p>
                            <div className="view-article-button">
                                <svg 
                                    xmlns="http://www.w3.org/2000/svg" 
                                    width="24" 
                                    height="24" 
                                    viewBox="0 0 24 24" 
                                    fill="none" 
                                    stroke="currentColor" 
                                    stroke-width="2" 
                                    stroke-linecap="round" 
                                    stroke-linejoin="round" 
                                    class="lucide lucide-arrow-right preview-icon">
                                        <path d="M5 12h14"/>
                                        <path d="m12 5 7 7-7 7"/>
                                </svg>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="news-scroll-links">
                    <div className="news-scroll-header">
                        <h3>NEWS</h3>
                    </div>
                    <div className="news-scroll-articles">
                        <div className="top-story">
                            <div className="top-story-image">
                                <img src="/iebc-image.jpeg" alt="iebc-image-story" />
                            </div>
                            <div className="top-story-tag">
                                <h4>TOP STORY</h4>
                            </div>
                            <div className="article-text">
                                <p>
                                    Election Bill 2026 risks transparency in the 2027 general 
                                    elections.
                                </p>
                            </div>
                            <div className="article-footer-text">
                                <p>News</p>
                                <p>9 hours ago</p>
                            </div>
                            <div className="hr-divider">
                                <hr />
                            </div>
                        </div>
                        <div className="other-stories">
                            <div className="article-text">
                                <p>
                                    Gachagua: We cannot allow Ruto to harass our candidate
                                </p>
                            </div>
                            <div className="article-footer-text">
                                <p>News</p>
                                <p>11 hours ago</p>
                            </div>
                            <div className="hr-divider">
                                <hr />
                            </div>
                        </div>
                        <div className="other-stories">
                            <div className="article-text">
                                <p>
                                    Former EACC CEO Halakhe Waqo among 9 shortlisted for IEBC CEO job
                                </p>
                            </div>
                            <div className="article-footer-text">
                                <p>News</p>
                                <p>15 hours ago</p>
                            </div>
                            <div className="hr-divider">
                                <hr />
                            </div>
                        </div>
                    </div>
                </div>
            </section>
            <section className="latest-news-section">
                <div className="latest-news-scroll-links">
                    <div className="latest-news-scroll-header">
                        <h3>LATEST</h3> <span>
                            <svg 
                                xmlns="http://www.w3.org/2000/svg" 
                                width="24" 
                                height="24" 
                                viewBox="0 0 24 24" 
                                fill="none" 
                                stroke="currentColor" 
                                stroke-width="2" 
                                stroke-linecap="round" 
                                stroke-linejoin="round" 
                                class="lucide lucide-refresh-ccw preview-icon">
                                    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                                    <path d="M3 3v5h5"/>
                                    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                                    <path d="M16 16h5v5"/>
                                </svg>
                        </span>
                    </div>
                </div>
            </section>
        </main>
        
);
}

export default HomePage;