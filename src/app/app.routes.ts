import { Routes } from '@angular/router';
import { accessGuard, readyGuard, signedOutGuard } from './core/guards';

export const routes: Routes = [
  {
    path: 'entrar',
    canActivate: [signedOutGuard],
    title: 'Entrar - Leio',
    loadComponent: () => import('./pages/login').then((m) => m.LoginPage),
  },
  {
    path: 'acesso',
    canActivate: [accessGuard],
    title: 'Acesso - Leio',
    loadComponent: () => import('./pages/access').then((m) => m.AccessPage),
  },
  {
    path: '',
    canActivateChild: [readyGuard],
    children: [
      { path: '', title: 'Leio', loadComponent: () => import('./pages/home').then((m) => m.HomePage) },
      {
        path: 'estatisticas',
        title: 'Páginas lidas - Leio',
        loadComponent: () => import('./pages/stats').then((m) => m.StatsPage),
      },
      {
        path: 'livros',
        title: 'Livros - Leio',
        loadComponent: () => import('./pages/books').then((m) => m.BooksPage),
      },
      {
        path: 'livro/:id',
        title: 'Livro - Leio',
        loadComponent: () => import('./pages/book-detail').then((m) => m.BookDetailPage),
      },
      {
        path: 'adicionar',
        title: 'Adicionar livro - Leio',
        loadComponent: () => import('./pages/add-book').then((m) => m.AddBookPage),
      },
      {
        path: 'meta',
        title: 'Meta de leitura - Leio',
        loadComponent: () => import('./pages/goal').then((m) => m.GoalPage),
      },
      {
        path: 'pessoas',
        title: 'Pessoas - Leio',
        loadComponent: () => import('./pages/people').then((m) => m.PeoplePage),
      },
      {
        path: 'pessoas/:uid',
        title: 'Perfil - Leio',
        loadComponent: () => import('./pages/person').then((m) => m.PersonPage),
      },
      {
        path: 'notificacoes',
        title: 'Notificações - Leio',
        loadComponent: () => import('./pages/notifications').then((m) => m.NotificationsPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
