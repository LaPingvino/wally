import classNames from 'classnames';
import { as } from 'folds';
import React from 'react';
import * as css from './Sidebar.css';

export const Sidebar = as<'nav'>(({ as: AsSidebar = 'nav', className, ...props }, ref) => (
  <AsSidebar className={classNames(css.Sidebar, className)} aria-label="Spaces" {...props} ref={ref} />
));
